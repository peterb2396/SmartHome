/**
 * Gas Boiler Service
 * ─────────────────────────────────────────────────────────────────
 * The gas boiler is a completely separate, 100%-isolated hydronic heating
 * PLANT — it shares no relay/actuator hardware with the air handler
 * (thermostat.js) — serving its own 3-zone layout: Great Room, Downstairs,
 * Upstairs. None of these get a dedicated new RS485 node: Great Room AND
 * Downstairs both read the air handler's existing "Downstairs" node
 * (one physical sensor, two independently-controlled zones — each still
 * gets its own on/off, target, and schedule, they just share a temperature
 * reading), and Upstairs reads the air handler's Primary Suite node (that's
 * the room this boiler zone actually covers). See ZONES' tempSensor fields
 * below — no new hardware needed for any of this, it's purely a matter of
 * which existing sensorStore key each zone's config points at. Each boiler
 * zone has its own motorized zone valve (simple energize-to-open, spring-
 * return-closed — no proportional position, unlike the air handler's
 * dampers). There's no separate "burner enable" relay: the boiler's own
 * zone valves have end switches already bused together and wired straight
 * into the boiler's thermostat-call terminals, so the boiler fires on its
 * own once a valve is confirmed physically open — see the wiring guide.
 *
 * This system only actually drives hardware while it's the "active" zone
 * layout — see thermostat.js's getActiveSystem()/setSystemActive() below.
 * It still computes calling/target state on every tick regardless (so nothing
 * looks dead in the UI, and schedule/override countdowns keep working),
 * it just holds every relay off if it isn't currently in charge of the
 * house's heat.
 *
 * ── Hardware ──────────────────────────────────────────────────────────
 * BOILER_BOARD (0x22), a 3rd daisy-chained I2C relay board (see
 * i2cRelay.js): channel 5 (CH6) Upstairs zone valve, channel 6 (CH7) Great
 * Room zone valve, channel 7 (CH8) Downstairs zone valve — confirmed
 * against real hardware wiring, only 3 relays wired on this board.
 * Channels 0-2, 3 (CH4), and 4 are spare — CH4 was originally reserved for
 * a "burner enable" relay, but the boiler's own zone valves have end
 * switches already bused together and wired straight into the boiler's
 * thermostat-call terminals (see the wiring guide), so that channel was
 * never wired and isn't referenced by this file. Free for a future use.
 */

const moment      = require('moment');
const sensors     = require('./sensorStore');
const settingsSvc = require('./settings');
const i2cRelay    = require('./i2cRelay');
const scheduleUtil = require('./scheduleUtil');
const { readEnvironment, updateEnvironmentAlerts } = require('./envSensors');
const { sendPush } = require('./mail');

const DEADBAND_F = 0.5;
const TICK_MS = 30000;

// Same hard safety range as thermostat.js — freeze/mold protection applies
// to every zone in the house regardless of which heating plant serves it.
const SAFETY_MIN_F = 60;
const SAFETY_MAX_F = 75;

// Confirmed via i2cdetect against real hardware (A1 jumper bridged).
const BOILER_BOARD = 0x22;
// Channel assignments confirmed against real wiring (CH6/7/8 — see header
// comment above for why CH4 is spare, not "boiler enable").
const CH = { UPSTAIRS: 5, GREAT_ROOM: 6, DOWNSTAIRS: 7 };

// tempSensor: no boiler zone gets a dedicated new RS485 node. Great Room
// AND Downstairs both read the air handler's existing "Downstairs" node —
// one physical sensor feeding two independently-controlled zones (each
// still has its own on/off, target, and schedule, see setZone()/
// setZoneSchedule() below — they just share a temperature reading rather
// than each having a thermostat's worth of hardware). Upstairs reads the
// air handler's Primary Suite node, the room it actually covers.
const ZONES = [
  { id: 'great-room', label: 'Great Room', tempSensor: 'temp-downstairs',    ch: CH.GREAT_ROOM },
  { id: 'downstairs', label: 'Downstairs', tempSensor: 'temp-downstairs',    ch: CH.DOWNSTAIRS },
  { id: 'upstairs',   label: 'Upstairs',   tempSensor: 'temp-primary-suite', ch: CH.UPSTAIRS },
];

const DEFAULT_SETTINGS = {
  zones: Object.fromEntries(ZONES.map(z => [z.id, { on: true, target: 68, schedule: [], override: null }])),
};

function clampToSafetyRange(target) {
  return Math.min(SAFETY_MAX_F, Math.max(SAFETY_MIN_F, target));
}

const runtime = Object.fromEntries(
  ZONES.map(z => [z.id, { calling: false, safety: 'normal', envStatus: {} }])
);
let systemActive = false; // true only while thermostat.js's getActiveSystem() says '3zone'

const { resolveTarget, isOverridden, nextBoundary } = scheduleUtil;

function getSettings() {
  const stored = settingsSvc.get()?.boiler;
  if (!stored) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    zones: Object.fromEntries(ZONES.map(z => [
      z.id,
      { ...DEFAULT_SETTINGS.zones[z.id], ...(stored.zones?.[z.id] || {}) },
    ])),
  };
}

async function saveSettings(next) {
  await settingsSvc.updateSetting('boiler', next);
}

// Applied by thermostat.js during a graceful zone-system swap — mutates the
// passed-in settings object in place (caller saves it afterward) and
// respects the same "don't clobber an active schedule block" rule as any
// other target write. Copies both the target AND the source zone's full
// weekly schedule, so this zone's own automatic schedule keeps working
// after the handoff instead of just getting a one-time target snapshot.
function applyExternalZone(settingsObj, zoneId, sourceZoneSettings, now) {
  const zs = settingsObj.zones[zoneId];
  if (!zs || !sourceZoneSettings || scheduleUtil.inScheduledBlock(zs, now)) return;
  settingsObj.zones[zoneId] = {
    ...zs,
    target: clampToSafetyRange(sourceZoneSettings.target),
    schedule: (sourceZoneSettings.schedule || []).map(b => ({ ...b, target: clampToSafetyRange(b.target) })),
    override: null,
  };
}

function updateSafetyState(zone, rt, currentTemp) {
  if (currentTemp === null) return;
  const was = rt.safety;
  let next = was;

  if (was === 'below-min') {
    if (currentTemp >= SAFETY_MIN_F + DEADBAND_F) next = 'normal';
  } else if (was === 'above-max') {
    if (currentTemp <= SAFETY_MAX_F - DEADBAND_F) next = 'normal';
  } else if (currentTemp < SAFETY_MIN_F) {
    next = 'below-min';
  } else if (currentTemp > SAFETY_MAX_F) {
    next = 'above-max';
  }

  if (next !== was) {
    if (next === 'below-min') {
      sendPush(
        `${zone.label} (boiler zone) has dropped to ${currentTemp.toFixed(1)}°F, below the ${SAFETY_MIN_F}°F minimum. Forcing heat to prevent freezing.`,
        'CRITICAL: Low Temperature'
      );
    } else if (next === 'above-max') {
      // The boiler has no cooling mode — above-max here just means "stop calling for heat," there's nothing further to force.
      sendPush(
        `${zone.label} (boiler zone) has risen to ${currentTemp.toFixed(1)}°F, above the ${SAFETY_MAX_F}°F maximum.`,
        'CRITICAL: High Temperature'
      );
    } else {
      sendPush(`${zone.label} (boiler zone) is back within the safe ${SAFETY_MIN_F}-${SAFETY_MAX_F}°F range (${currentTemp.toFixed(1)}°F).`, 'Thermostat: Resolved');
    }
  }
  rt.safety = next;
}

function setSystemActive(active) {
  systemActive = active;
}

async function tick() {
  const settings = getSettings();
  const now = moment();

  for (const zone of ZONES) {
    const zs = settings.zones[zone.id];
    const rt = runtime[zone.id];

    const reading = sensors.get(zone.tempSensor);
    const currentTemp = typeof reading?.value === 'number' ? reading.value : null;

    updateSafetyState(zone, rt, currentTemp);
    updateEnvironmentAlerts(zone.label, rt, readEnvironment(zone.id));

    if (currentTemp === null) {
      rt.calling = false;
      continue;
    }

    let heatCall = zs.on ? rt.calling : false;
    if (zs.on) {
      const target = resolveTarget(zs, now);
      if (!rt.calling && currentTemp < target - DEADBAND_F) heatCall = true;
      else if (rt.calling && currentTemp >= target + DEADBAND_F) heatCall = false;
    }
    if (rt.safety === 'below-min') heatCall = true; // freeze protection wins outright, on or off

    rt.calling = heatCall;
  }

  for (const zone of ZONES) {
    const on = systemActive && runtime[zone.id].calling;
    i2cRelay.setChannel(BOILER_BOARD, zone.ch, on);
  }
}

async function setZone(zoneId, { target, on }) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown boiler zone ${zoneId}`);
  const zs = { ...settings.zones[zoneId] };
  if (typeof on === 'boolean') zs.on = on;
  if (typeof target === 'number') {
    const clamped = clampToSafetyRange(target);
    zs.target = clamped;
    zs.override = { target: clamped, untilTime: nextBoundary(zs.schedule, moment()) };
  }
  const next = { ...settings, zones: { ...settings.zones, [zoneId]: zs } };
  await saveSettings(next);
  await tick();
  return next;
}

async function setZoneSchedule(zoneId, schedule) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown boiler zone ${zoneId}`);
  const clamped = schedule.map(b => ({ ...b, target: clampToSafetyRange(b.target) }));
  const zs = { ...settings.zones[zoneId], schedule: clamped, override: null };
  const next = { ...settings, zones: { ...settings.zones, [zoneId]: zs } };
  await saveSettings(next);
  await tick();
  return next;
}

function getState() {
  const settings = getSettings();
  const now = moment();
  return {
    active: systemActive,
    safetyRange: { min: SAFETY_MIN_F, max: SAFETY_MAX_F },
    zones: ZONES.map(zone => {
      const zs = settings.zones[zone.id];
      const reading = sensors.get(zone.tempSensor);
      const hasReading = typeof reading?.value === 'number';
      const stale = hasReading && reading.stale;
      const rt = runtime[zone.id];
      return {
        id: zone.id,
        label: zone.label,
        on: zs.on,
        target: resolveTarget(zs, now),
        overridden: isOverridden(zs, now),
        overrideUntil: zs.override?.untilTime ?? null,
        schedule: zs.schedule,
        currentTemp: hasReading ? reading.value : null,
        updatedAt: reading?.updatedAt ?? null,
        sensorOk: hasReading && !stale,
        calling: rt.calling && systemActive,
        safety: rt.safety,
        environment: readEnvironment(zone.id),
      };
    }),
  };
}

function shutdown() {
  for (const zone of ZONES) i2cRelay.setChannel(BOILER_BOARD, zone.ch, false);
}

async function init() {
  if (!settingsSvc.get()?.boiler) {
    await saveSettings(DEFAULT_SETTINGS);
  }
  for (const zone of ZONES) i2cRelay.setChannel(BOILER_BOARD, zone.ch, false);

  setInterval(() => { tick().catch(err => console.error('[Boiler] Tick error:', err.message)); }, TICK_MS);
  console.log('[Boiler] Initialized.');
}

module.exports = {
  init,
  getState,
  setZone,
  setZoneSchedule,
  setSystemActive,
  getSettings,
  saveSettings,
  applyExternalZone,
  shutdown,
  ZONES,
};
