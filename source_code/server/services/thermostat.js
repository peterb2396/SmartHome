/**
 * Thermostat Service
 * ─────────────────────────────────────────────────────────────────
 * Multi-zone digital thermostat for the central-air + gas-baseboard
 * dual-fuel system. All decision logic lives here — the attic ESP32
 * node and the basement Pi's GPIO pins are just I/O.
 *
 * Zones                Primary Suite, Upstairs, Office, Downstairs
 * Heat sources          gas (baseboard), electric (15kW coil), air (heat pump)
 *
 * Wiring:
 *   node: 'basement' → relay wired directly to this Pi (gpio.js createPin)
 *   node: 'attic'    → relay is on the (future) attic ESP32. Desired state
 *                       is exposed via getAtticRelayCommands() and returned
 *                       in the response body of POST /esp32/report, so the
 *                       node applies it on its next check-in. No inbound
 *                       connection to the ESP32 is needed.
 *
 * Add/remove zones or relay pins in the ZONES / PLANT_RELAYS config below.
 */

const moment      = require('moment');
const cron        = require('node-cron');
const sensors     = require('./sensorStore');
const settingsSvc = require('./settings');
const gpioSvc     = require('./gpio');
const astro       = require('./astro');
const { sendPush } = require('./mail');

const CRON_OPTS = { scheduled: true, timezone: astro.TZ };
const DEADBAND_F = 0.5;          // hysteresis
const TICK_MS = 30000;           // control loop cadence

// ── Zone / relay configuration ───────────────────────────────────────────────
// BCM pin numbers are placeholders — edit to match actual wiring.
const ZONES = [
  { id: 'primary-suite', label: 'Primary Suite', tempSensor: 'temp-primary-suite', node: 'attic',    relayName: 'zone-primary-suite', windowSensors: ['window-primary-suite'] },
  { id: 'upstairs',      label: 'Upstairs',       tempSensor: 'temp-upstairs',      node: 'attic',    relayName: 'zone-upstairs',       windowSensors: ['window-upstairs'] },
  { id: 'office',        label: 'Office',         tempSensor: 'temp-office',        node: 'basement', relayPin: 17,                     windowSensors: ['window-office'] },
  { id: 'downstairs',    label: 'Downstairs',     tempSensor: 'temp-downstairs',     node: 'basement', relayPin: 27,                     windowSensors: ['window-front', 'window-back'] },
];

const PLANT_RELAYS = { gas: 20, electric: 21, air: 26 }; // basement Pi, BCM pins

const DEFAULT_SETTINGS = {
  mode: 'auto',            // 'auto' | 'gas' | 'electric' | 'air'
  activeSource: 'gas',     // resolved source currently in use
  lastDecision: null,      // { date, costs, avgOutdoorTempF, cheapest }
  rates: {
    gasPricePerTherm: 1.50,  // $/therm
    elecPricePerKwh: 0.15,   // $/kWh
    gasAfue: 0.85,           // boiler efficiency, 0-1
  },
  zones: Object.fromEntries(ZONES.map(z => [z.id, { on: false, target: 68, schedule: [] }])),
};

// ── Heat pump COP curve (efficiency drops as it gets colder outside) ────────
const COP_CURVE = [
  { temp: 47, cop: 3.2 },
  { temp: 35, cop: 2.6 },
  { temp: 17, cop: 2.0 },
  { temp: 5,  cop: 1.5 },
  { temp: -10, cop: 1.1 },
];

function copForOutdoorTemp(tempF) {
  const pts = COP_CURVE;
  if (tempF >= pts[0].temp) return pts[0].cop;
  if (tempF <= pts[pts.length - 1].temp) return pts[pts.length - 1].cop;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (tempF <= a.temp && tempF >= b.temp) {
      const frac = (a.temp - tempF) / (a.temp - b.temp);
      return a.cop + (b.cop - a.cop) * frac;
    }
  }
  return pts[pts.length - 1].cop;
}

const THERM_TO_KWH = 29.3001;

// ── In-memory runtime state (ephemeral, like sensorStore) ───────────────────
const runtime = Object.fromEntries(
  ZONES.map(z => [z.id, { calling: false, windowOpen: false }])
);
const atticRelayCommands = {}; // { relayName: boolean }
const basementZonePins = {};   // { zoneId: GpioPin }
const plantPins = {};          // { source: GpioPin }

// ── Settings helpers ─────────────────────────────────────────────────────────
function getSettings() {
  const stored = settingsSvc.get()?.thermostat;
  if (!stored) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    rates: { ...DEFAULT_SETTINGS.rates, ...(stored.rates || {}) },
    zones: Object.fromEntries(ZONES.map(z => [
      z.id,
      { ...DEFAULT_SETTINGS.zones[z.id], ...(stored.zones?.[z.id] || {}) },
    ])),
  };
}

async function saveSettings(next) {
  await settingsSvc.updateSetting('thermostat', next);
}

// ── Schedule resolution ──────────────────────────────────────────────────────
function resolveTarget(zoneSettings, now) {
  const dow = now.day();
  const hm = now.format('HH:mm');
  const matches = (zoneSettings.schedule || []).filter(
    b => (b.day === dow || b.day === 'all') && hm >= b.start && hm < b.end
  );
  if (matches.length) return matches[matches.length - 1].target;
  return zoneSettings.target ?? 68;
}

function windowsOpenForZone(zone) {
  return zone.windowSensors.some(name => sensors.get(name)?.value === 'open');
}

// ── Control loop ─────────────────────────────────────────────────────────────
function tick() {
  const settings = getSettings();
  const now = moment();

  for (const zone of ZONES) {
    const zs = settings.zones[zone.id];
    const rt = runtime[zone.id];
    rt.windowOpen = windowsOpenForZone(zone);

    if (!zs.on) {
      rt.calling = false;
      writeZoneRelay(zone, false);
      continue;
    }

    const reading = sensors.get(zone.tempSensor);
    const currentTemp = typeof reading?.value === 'number' ? reading.value : null;
    const target = resolveTarget(zs, now);

    let calling = rt.calling;
    if (currentTemp === null) {
      // No sensor data — fail safe, don't call for heat.
      calling = false;
    } else if (!rt.calling && currentTemp < target - DEADBAND_F) {
      calling = true;
    } else if (rt.calling && currentTemp >= target + DEADBAND_F) {
      calling = false;
    }

    const wasCalling = rt.calling;
    rt.calling = calling;

    if (calling && !wasCalling && rt.windowOpen) {
      sendPush(
        `${zone.label} is turning on heat but has an open window.`,
        'Thermostat Warning'
      );
    }

    writeZoneRelay(zone, calling);
  }

  drivePlantRelays(settings);
}

function writeZoneRelay(zone, on) {
  if (zone.node === 'basement') {
    basementZonePins[zone.id]?.writeSync(on ? 1 : 0);
  } else {
    atticRelayCommands[zone.relayName] = on;
  }
}

function drivePlantRelays(settings) {
  const anyCalling = ZONES.some(z => runtime[z.id].calling);
  for (const source of Object.keys(PLANT_RELAYS)) {
    const on = anyCalling && settings.activeSource === source;
    plantPins[source]?.writeSync(on ? 1 : 0);
  }
}

// ── Nightly cost decision ────────────────────────────────────────────────────
function costPerUnit(source, avgOutdoorTempF, rates) {
  if (source === 'gas') return rates.gasPricePerTherm / THERM_TO_KWH / rates.gasAfue;
  if (source === 'electric') return rates.elecPricePerKwh;
  if (source === 'air') return rates.elecPricePerKwh / copForOutdoorTemp(avgOutdoorTempF);
  throw new Error(`Unknown source ${source}`);
}

async function runCostDecision() {
  const settings = getSettings();
  const today = new Date();
  try {
    const { temps } = await astro.getHourlyForecast(today);
    const valid = temps.filter(t => typeof t === 'number');
    const avgOutdoorTempF = valid.length
      ? valid.reduce((a, b) => a + b, 0) / valid.length
      : 40; // conservative fallback

    const costs = {
      gas: costPerUnit('gas', avgOutdoorTempF, settings.rates),
      electric: costPerUnit('electric', avgOutdoorTempF, settings.rates),
      air: costPerUnit('air', avgOutdoorTempF, settings.rates),
    };
    const cheapest = Object.entries(costs).sort((a, b) => a[1] - b[1])[0][0];

    const next = {
      ...settings,
      activeSource: settings.mode === 'auto' ? cheapest : settings.activeSource,
      lastDecision: {
        date: moment(today).format('YYYY-MM-DD'),
        costs,
        avgOutdoorTempF: Math.round(avgOutdoorTempF * 10) / 10,
        cheapest,
      },
    };
    await saveSettings(next);
    console.log(`[Thermostat] Cost decision: cheapest=${cheapest}`, costs);
  } catch (err) {
    console.error('[Thermostat] Cost decision error:', err.message);
  }
}

// ── Public mutation API (used by routes) ────────────────────────────────────
async function setZone(zoneId, { on, target }) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown zone ${zoneId}`);
  const zs = { ...settings.zones[zoneId] };
  if (typeof on === 'boolean') zs.on = on;
  if (typeof target === 'number') zs.target = target;
  const next = { ...settings, zones: { ...settings.zones, [zoneId]: zs } };
  await saveSettings(next);
  return next;
}

async function setZoneSchedule(zoneId, schedule) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown zone ${zoneId}`);
  const zs = { ...settings.zones[zoneId], schedule };
  const next = { ...settings, zones: { ...settings.zones, [zoneId]: zs } };
  await saveSettings(next);
  return next;
}

async function setMode(mode) {
  const settings = getSettings();
  if (!['auto', 'gas', 'electric', 'air'].includes(mode)) {
    throw new Error(`Invalid mode ${mode}`);
  }
  const next = {
    ...settings,
    mode,
    // A manual override takes effect immediately; 'auto' keeps whatever
    // activeSource the last midnight decision (or an initial boot-time
    // decision) resolved to, until the next midnight run.
    activeSource: mode === 'auto' ? settings.activeSource : mode,
  };
  await saveSettings(next);
  return next;
}

async function setRates(rates) {
  const settings = getSettings();
  const next = { ...settings, rates: { ...settings.rates, ...rates } };
  await saveSettings(next);
  return next;
}

// A zone's temp sensor counts as responding if it has ever reported AND that
// report isn't older than this — well beyond the ESP32/GPIO report cadence,
// so a sensor that's actually alive never trips it.
const SENSOR_STALE_MS = 5 * 60 * 1000;

function getState() {
  const settings = getSettings();
  return {
    mode: settings.mode,
    activeSource: settings.activeSource,
    lastDecision: settings.lastDecision,
    rates: settings.rates,
    zones: ZONES.map(zone => {
      const zs = settings.zones[zone.id];
      const reading = sensors.get(zone.tempSensor);
      const hasReading = typeof reading?.value === 'number';
      const stale = hasReading && (Date.now() - new Date(reading.updatedAt).getTime()) > SENSOR_STALE_MS;
      return {
        id: zone.id,
        label: zone.label,
        on: zs.on,
        target: zs.target,
        schedule: zs.schedule,
        currentTemp: hasReading ? reading.value : null,
        updatedAt: reading?.updatedAt ?? null,
        sensorOk: hasReading && !stale,
        calling: runtime[zone.id].calling,
        windowOpen: runtime[zone.id].windowOpen,
      };
    }),
  };
}

function getAtticRelayCommands() {
  return { ...atticRelayCommands };
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (!settingsSvc.get()?.thermostat) {
    await saveSettings(DEFAULT_SETTINGS);
  }

  for (const zone of ZONES) {
    if (zone.node === 'basement') {
      basementZonePins[zone.id] = gpioSvc.createPin(zone.relayPin, 'out');
      basementZonePins[zone.id].writeSync(0);
    } else {
      atticRelayCommands[zone.relayName] = false;
    }
  }
  for (const [source, pin] of Object.entries(PLANT_RELAYS)) {
    plantPins[source] = gpioSvc.createPin(pin, 'out');
    plantPins[source].writeSync(0);
  }

  const settings = getSettings();
  const today = moment().format('YYYY-MM-DD');
  if (settings.lastDecision?.date !== today) {
    await runCostDecision();
  }

  setInterval(tick, TICK_MS);

  cron.schedule('0 0 * * *', async () => {
    console.log('[Thermostat] Midnight cost decision');
    await runCostDecision();
  }, CRON_OPTS);

  console.log('[Thermostat] Initialized.');
}

module.exports = {
  init,
  getState,
  setZone,
  setZoneSchedule,
  setMode,
  setRates,
  getAtticRelayCommands,
  ZONES,
};
