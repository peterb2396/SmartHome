/**
 * Thermostat Service
 * ─────────────────────────────────────────────────────────────────
 * Multi-zone digital thermostat for the central air handler/condenser
 * (heating coil + heat pump + AC cooling, all one physical unit) plus a
 * totally separate gas boiler. All decision logic lives here — the attic
 * ESP32 node and the basement Pi's GPIO pins are just I/O.
 *
 * Zones                Primary Suite, Upstairs, Office, Downstairs
 * Heat sources          gas (boiler), electric (15kW coil in the air handler),
 *                       air (heat pump mode of the condenser)
 * Cooling               Always the condenser's AC/cooling mode — it's the
 *                       only equipment that can cool, so cooling never goes
 *                       through the Gas/Electric/Air heat-source selection.
 *
 * Each zone has one dial (a target temperature) and one on/off switch —
 * no separate heat/cool/off mode to pick, heat vs. cool is always decided
 * automatically by comparing current temp to target.
 *
 *   on:  follows the zone's weekly schedule by default. Manually nudging
 *        the target (dial drag, +/-) creates a temporary hold that lasts
 *        until the next scheduled block change, then reverts to whatever
 *        that block specifies. See resolveTarget()/currentBlockKey().
 *   off: no comfort call at all — the zone drifts to whatever temperature
 *        it naturally settles at.
 *
 * The 60-75°F freeze/mold safety floor and ceiling apply UNCONDITIONALLY
 * either way — off does not mean unprotected. See updateSafetyState().
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

// ── Hard safety floor/ceiling ─────────────────────────────────────────────────
// Comfort logic alone (target ± deadband) already keeps every zone well
// inside this range in normal operation, since target itself is clamped
// here. This is the backstop for when that's not enough — target set right
// at the edge of the allowed range, equipment lag, a failure — freeze/pipe
// protection on the low end, mold/heat protection on the high end. It wins
// over the comfort hysteresis outright rather than relying on the band
// alone. See updateSafetyState().
const SAFETY_MIN_F = 60;
const SAFETY_MAX_F = 75;

// ── Zone / relay configuration ───────────────────────────────────────────────
// BCM pin numbers are placeholders — edit to match actual wiring.
const ZONES = [
  { id: 'primary-suite', label: 'Primary Suite', tempSensor: 'temp-primary-suite', node: 'attic',    relayName: 'zone-primary-suite', windowSensors: ['window-primary-suite'] },
  { id: 'upstairs',      label: 'Upstairs',       tempSensor: 'temp-upstairs',      node: 'attic',    relayName: 'zone-upstairs',       windowSensors: ['window-upstairs'] },
  { id: 'office',        label: 'Office',         tempSensor: 'temp-office',        node: 'basement', relayPin: 17,                     windowSensors: ['window-office'] },
  { id: 'downstairs',    label: 'Downstairs',     tempSensor: 'temp-downstairs',     node: 'basement', relayPin: 27,                     windowSensors: ['window-front', 'window-back'] },
];

const PLANT_RELAYS = { gas: 20, electric: 21, air: 26 }; // basement Pi, BCM pins — heating calls

// Reversing valve / cooling-mode select for the heat pump — only the "air"
// source can cool. Energized whenever ANY zone needs safety cooling (see
// SAFETY_MAX_F above); a heat pump can't heat and cool at once, so cooling
// always wins over a comfort heat call that would otherwise use "air".
const COOL_MODE_RELAY_PIN = 19; // basement Pi, BCM pin — placeholder, edit to match actual wiring

const DEFAULT_SETTINGS = {
  mode: 'auto',            // 'auto' | 'gas' | 'electric' | 'air'
  activeSource: 'gas',     // resolved source currently in use
  lastDecision: null,      // { date, costs, avgOutdoorTempF, cheapest }
  rates: {
    gasPricePerTherm: 1.50,  // $/therm
    elecPricePerKwh: 0.15,   // $/kWh
    gasAfue: 0.85,           // boiler efficiency, 0-1
  },
  // The electric coil is intentionally a manual "everything else is down"
  // backup, not a cost competitor — it's always the most expensive option,
  // so it only gets selected when gas and/or air are marked unavailable
  // (e.g. mid-service). See setAvailability()/pickAvailableSource() below.
  available: { gas: true, electric: true, air: true },
  // on: whether comfort control is active for this zone (safety floor/
  // ceiling apply either way). override: a manual target that holds until
  // the schedule moves into a different block — see resolveTarget().
  zones: Object.fromEntries(ZONES.map(z => [z.id, { on: true, target: 68, schedule: [], override: null }])),
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

function clampToSafetyRange(target) {
  return Math.min(SAFETY_MAX_F, Math.max(SAFETY_MIN_F, target));
}

// ── In-memory runtime state (ephemeral, like sensorStore) ───────────────────
// safety: 'normal' | 'below-min' | 'above-max' — hysteresis state for the
// hard floor/ceiling, tracked independently of the zone's own on/off state.
const runtime = Object.fromEntries(
  ZONES.map(z => [z.id, { calling: false, coolCalling: false, windowOpen: false, safety: 'normal' }])
);
const atticRelayCommands = {}; // { relayName: boolean }
const basementZonePins = {};   // { zoneId: GpioPin }
const plantPins = {};          // { source: GpioPin }
let coolModePin = null;

// ── Settings helpers ─────────────────────────────────────────────────────────
function getSettings() {
  const stored = settingsSvc.get()?.thermostat;
  if (!stored) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    rates: { ...DEFAULT_SETTINGS.rates, ...(stored.rates || {}) },
    available: { ...DEFAULT_SETTINGS.available, ...(stored.available || {}) },
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
// A stable identity for "whichever schedule block is active right now" (or
// null if none is) — used to detect when we've crossed into a different
// block, which is when a manual override expires. Content-based rather than
// an array index, so it survives the blocks being reordered.
function currentBlockKey(schedule, now) {
  const b = matchingBlock(schedule, now);
  return b ? `${b.day}|${b.start}|${b.end}` : null;
}

function matchingBlock(schedule, now) {
  const dow = now.day();
  const hm = now.format('HH:mm');
  const matches = (schedule || []).filter(
    b => (b.day === dow || b.day === 'all') && hm >= b.start && hm < b.end
  );
  return matches.length ? matches[matches.length - 1] : null;
}

// The target actually in effect right now: a manual override (if one is set
// AND we're still within the same block-window it was set in), else
// whatever the schedule says for this moment, else the zone's base target.
function resolveTarget(zoneSettings, now) {
  const key = currentBlockKey(zoneSettings.schedule, now);
  if (zoneSettings.override && zoneSettings.override.untilBlockKey === key) {
    return zoneSettings.override.target;
  }
  const block = matchingBlock(zoneSettings.schedule, now);
  return block ? block.target : (zoneSettings.target ?? 68);
}

function isOverridden(zoneSettings, now) {
  const key = currentBlockKey(zoneSettings.schedule, now);
  return !!(zoneSettings.override && zoneSettings.override.untilBlockKey === key);
}

function windowsOpenForZone(zone) {
  return zone.windowSensors.some(name => sensors.get(name)?.value === 'open');
}

// ── Safety floor/ceiling ──────────────────────────────────────────────────────
// Uses the same deadband-hysteresis shape as comfort calls so it doesn't
// short-cycle right at the boundary. Pushes on every state transition —
// into a violation, and back out of one — since "did the response actually
// work" matters as much as the initial alert. In normal operation this
// should essentially never trip, since comfort logic already keeps zones
// well inside 60-75°F — if it does trip, something's actually wrong
// (equipment down, sensor lag, extreme weather overwhelming capacity).
function updateSafetyState(zone, rt, currentTemp, settings) {
  if (currentTemp === null) return; // no data — can't evaluate, leave last known state
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
        `${zone.label} has dropped to ${currentTemp.toFixed(1)}°F, below the ${SAFETY_MIN_F}°F minimum. ` +
        `Forcing heat to prevent freezing — comfort control alone wasn't enough.`,
        'CRITICAL: Low Temperature'
      );
    } else if (next === 'above-max') {
      const note = settings.available.air === false ? ' Air/heat pump is currently marked as being serviced, so it may not be able to respond.' : '';
      sendPush(
        `${zone.label} has risen to ${currentTemp.toFixed(1)}°F, above the ${SAFETY_MAX_F}°F maximum. ` +
        `Forcing cooling to prevent heat/mold damage — comfort control alone wasn't enough.${note}`,
        'CRITICAL: High Temperature'
      );
    } else {
      sendPush(`${zone.label} is back within the safe ${SAFETY_MIN_F}-${SAFETY_MAX_F}°F range (${currentTemp.toFixed(1)}°F).`, 'Thermostat: Resolved');
    }
  }
  rt.safety = next;
}

// ── Control loop ─────────────────────────────────────────────────────────────
function tick() {
  const settings = getSettings();
  const now = moment();

  // Pass 1: per-zone desired heat/cool calls. Comfort control (target ±
  // deadband, heat below / cool above) only runs while the zone is on; off
  // just stops steering it, it doesn't disable the zone. The hard safety
  // floor/ceiling is a backstop on top of ALL of this — it wins outright
  // regardless of on/off if the zone somehow ends up outside 60-75°F
  // (see updateSafetyState()).
  for (const zone of ZONES) {
    const zs = settings.zones[zone.id];
    const rt = runtime[zone.id];
    rt.windowOpen = windowsOpenForZone(zone);

    const reading = sensors.get(zone.tempSensor);
    const currentTemp = typeof reading?.value === 'number' ? reading.value : null;

    updateSafetyState(zone, rt, currentTemp, settings);

    if (currentTemp === null) {
      // No sensor data — fail safe, don't call for anything.
      rt.calling = false;
      rt.coolCalling = false;
      continue;
    }

    let heatCall = false;
    let coolCall = false;

    if (zs.on) {
      const target = resolveTarget(zs, now);
      heatCall = rt.calling;
      if (!rt.calling && currentTemp < target - DEADBAND_F) heatCall = true;
      else if (rt.calling && currentTemp >= target + DEADBAND_F) heatCall = false;

      coolCall = rt.coolCalling;
      if (!rt.coolCalling && currentTemp > target + DEADBAND_F) coolCall = true;
      else if (rt.coolCalling && currentTemp <= target - DEADBAND_F) coolCall = false;
    }
    // zs.on === false -> no comfort call; let it drift. The safety check
    // below is still live regardless.

    // Safety wins outright over the comfort band above.
    if (rt.safety === 'below-min') { heatCall = true; coolCall = false; }
    else if (rt.safety === 'above-max') { coolCall = true; heatCall = false; }

    const wasCalling = rt.calling;
    const wasCooling = rt.coolCalling;
    rt.calling = heatCall;
    rt.coolCalling = coolCall;

    if (((heatCall && !wasCalling) || (coolCall && !wasCooling)) && rt.windowOpen) {
      sendPush(
        `${zone.label} is turning on ${coolCall ? 'cooling' : 'heat'} but has an open window.`,
        'Thermostat Warning'
      );
    }
  }

  // Pass 2: system-wide arbitration + relay writes. A heat pump can't heat
  // and cool at once — if any zone needs safety cooling, that wins, and
  // zone dampers that would only be open for an "air"-sourced heat call
  // stay closed this tick rather than get cold air pushed into them.
  const anyCooling = ZONES.some(z => runtime[z.id].coolCalling);
  const airHandlesHeat = settings.activeSource === 'air';

  for (const zone of ZONES) {
    const rt = runtime[zone.id];
    const heatSuppressed = rt.calling && anyCooling && airHandlesHeat;
    writeZoneRelay(zone, (rt.calling && !heatSuppressed) || rt.coolCalling);
  }

  drivePlantRelays(settings, anyCooling, airHandlesHeat);
}

function writeZoneRelay(zone, on) {
  if (zone.node === 'basement') {
    basementZonePins[zone.id]?.writeSync(on ? 1 : 0);
  } else {
    atticRelayCommands[zone.relayName] = on;
  }
}

function drivePlantRelays(settings, anyCooling, airHandlesHeat) {
  const anyHeatCalling = ZONES.some(z => runtime[z.id].calling);

  for (const source of Object.keys(PLANT_RELAYS)) {
    let on;
    if (source === 'air') {
      const wantsHeatViaAir = anyHeatCalling && airHandlesHeat && !anyCooling;
      // Hard invariant: a source marked unavailable (being serviced) NEVER
      // gets energized, no matter what activeSource/mode says elsewhere —
      // this is the one place actual heating hardware gets switched on.
      on = (anyCooling || wantsHeatViaAir) && settings.available.air !== false;
    } else {
      on = anyHeatCalling && settings.activeSource === source && settings.available[source] !== false;
    }
    plantPins[source]?.writeSync(on ? 1 : 0);
  }

  // Same invariant for cooling — never energize the reversing valve for a
  // heat pump that's marked as being serviced.
  coolModePin?.writeSync((anyCooling && settings.available.air !== false) ? 1 : 0);
}

// ── Nightly cost decision ────────────────────────────────────────────────────
function costPerUnit(source, avgOutdoorTempF, rates) {
  if (source === 'gas') return rates.gasPricePerTherm / THERM_TO_KWH / rates.gasAfue;
  if (source === 'electric') return rates.elecPricePerKwh;
  if (source === 'air') return rates.elecPricePerKwh / copForOutdoorTemp(avgOutdoorTempF);
  throw new Error(`Unknown source ${source}`);
}

// ── Gas vs. heat pump crossover ────────────────────────────────────────────
// At what outdoor temperature do gas and the heat pump cost the same?
// Above it the heat pump's COP is high enough to beat gas; below it, gas
// wins. Purely a function of the configured rates (not the day's forecast),
// so it's recomputed live in getState() — always current with whatever the
// user just saved in the rates modal, nothing to cache or go stale.
function computeCrossover(rates) {
  const gasCost = costPerUnit('gas', null, rates);
  const targetCop = rates.elecPricePerKwh / gasCost;
  const best = COP_CURVE[0];                      // warmest point -> highest COP -> air cheapest here
  const worst = COP_CURVE[COP_CURVE.length - 1];   // coldest point -> lowest COP -> air priciest here

  if (targetCop <= worst.cop) {
    return { tempF: null, warmerIsCheaper: 'air', colderIsCheaper: 'air' }; // air wins even at its worst
  }
  if (targetCop >= best.cop) {
    return { tempF: null, warmerIsCheaper: 'gas', colderIsCheaper: 'gas' }; // gas wins even at air's best
  }
  for (let i = 0; i < COP_CURVE.length - 1; i++) {
    const a = COP_CURVE[i], b = COP_CURVE[i + 1];
    if (targetCop <= a.cop && targetCop >= b.cop) {
      const frac = (a.cop - targetCop) / (a.cop - b.cop);
      const tempF = a.temp - frac * (a.temp - b.temp);
      return { tempF: Math.round(tempF * 10) / 10, warmerIsCheaper: 'air', colderIsCheaper: 'gas' };
    }
  }
  /* istanbul ignore next -- unreachable given the two bounds checked above */
  return { tempF: null, warmerIsCheaper: 'air', colderIsCheaper: 'gas' };
}

// Cheapest source among those not marked unavailable. Electric is the
// manual backup — it only wins here if gas/air are both down, since its
// cost is otherwise always the highest (COP fixed at 1, see costPerUnit).
function pickAvailableSource(costs, available) {
  const eligible = Object.keys(PLANT_RELAYS).filter(s => available[s] !== false);
  if (eligible.length === 0) return null; // everything marked unavailable — caller decides fallback
  return eligible.sort((a, b) => costs[a] - costs[b])[0];
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

    // Costs are computed for all three sources regardless of availability,
    // so the UI can still show "gas would be $X" even while it's serviced.
    const costs = {
      gas: costPerUnit('gas', avgOutdoorTempF, settings.rates),
      electric: costPerUnit('electric', avgOutdoorTempF, settings.rates),
      air: costPerUnit('air', avgOutdoorTempF, settings.rates),
    };
    const cheapestAvailable = pickAvailableSource(costs, settings.available) ?? settings.activeSource;

    const next = {
      ...settings,
      activeSource: settings.mode === 'auto' ? cheapestAvailable : settings.activeSource,
      lastDecision: {
        date: moment(today).format('YYYY-MM-DD'),
        costs,
        avgOutdoorTempF: Math.round(avgOutdoorTempF * 10) / 10,
        cheapest: cheapestAvailable,
      },
    };
    await saveSettings(next);
    console.log(`[Thermostat] Cost decision: cheapest available=${cheapestAvailable}`, costs);
  } catch (err) {
    console.error('[Thermostat] Cost decision error:', err.message);
  }
}

// ── Public mutation API (used by routes) ────────────────────────────────────
async function setZone(zoneId, { target, on }) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown zone ${zoneId}`);
  const zs = { ...settings.zones[zoneId] };
  if (typeof on === 'boolean') zs.on = on;
  // Hard-clamped — the 60-75°F range is a safety limit, not just a default,
  // so it can't be bypassed via a target that's set outside it either.
  if (typeof target === 'number') {
    const clamped = clampToSafetyRange(target);
    zs.target = clamped;
    // Manually nudging the target creates a hold tied to whichever
    // schedule block (or gap between blocks) is active right now — it
    // stops applying as soon as we move into a different one. See
    // resolveTarget().
    zs.override = { target: clamped, untilBlockKey: currentBlockKey(zs.schedule, moment()) };
  }
  const next = { ...settings, zones: { ...settings.zones, [zoneId]: zs } };
  await saveSettings(next);
  return next;
}

async function setZoneSchedule(zoneId, schedule) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown zone ${zoneId}`);
  const clamped = schedule.map(b => ({ ...b, target: clampToSafetyRange(b.target) }));
  // A freshly-saved schedule invalidates any pending hold from the old one.
  const zs = { ...settings.zones[zoneId], schedule: clamped, override: null };
  const next = { ...settings, zones: { ...settings.zones, [zoneId]: zs } };
  await saveSettings(next);
  return next;
}

async function setMode(mode) {
  const settings = getSettings();
  if (!['auto', 'gas', 'electric', 'air'].includes(mode)) {
    throw new Error(`Invalid mode ${mode}`);
  }
  if (mode !== 'auto' && settings.available[mode] === false) {
    throw new Error(`${mode} is currently marked as being serviced and can't be selected`);
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
  // Re-evaluate immediately with the new rates rather than leaving
  // activeSource pointing at whatever the last midnight/boot decision
  // picked — otherwise editing rates has no visible effect until the next
  // midnight cron, which reads as "it just didn't work."
  await runCostDecision();
  return getSettings();
}

// Mark a heat source as being serviced (or back in service). Taking the
// currently-selected/active source offline fails over immediately — using
// the last known costs, or a fixed gas > air > electric priority if we
// haven't run a cost check yet — rather than waiting for the next manual
// change or the midnight cron.
async function setAvailability(source, available) {
  if (!PLANT_RELAYS[source]) throw new Error(`Unknown source ${source}`);
  const settings = getSettings();
  const nextAvailable = { ...settings.available, [source]: available };
  let next = { ...settings, available: nextAvailable };

  if (!available && (settings.mode === source || settings.activeSource === source)) {
    const costs = settings.lastDecision?.costs;
    const replacement = costs
      ? pickAvailableSource(costs, nextAvailable)
      : ['gas', 'air', 'electric'].find(s => nextAvailable[s] !== false && s !== source);
    next = { ...next, mode: 'auto', activeSource: replacement ?? settings.activeSource };
  }

  await saveSettings(next);
  return next;
}

function getState() {
  const settings = getSettings();
  return {
    mode: settings.mode,
    activeSource: settings.activeSource,
    lastDecision: settings.lastDecision,
    rates: settings.rates,
    available: settings.available,
    safetyRange: { min: SAFETY_MIN_F, max: SAFETY_MAX_F },
    crossover: computeCrossover(settings.rates),
    zones: ZONES.map(zone => {
      const zs = settings.zones[zone.id];
      // sensors.get() already computes `stale` (sensorStore.js's shared
      // freshness logic, tied to the once-a-minute gather cycle) — the
      // safety-range check and the general sensor views both read through it.
      const reading = sensors.get(zone.tempSensor);
      const hasReading = typeof reading?.value === 'number';
      const stale = hasReading && reading.stale;
      const rt = runtime[zone.id];
      const now = moment();
      return {
        id: zone.id,
        label: zone.label,
        on: zs.on,
        // The currently-effective target — schedule block, manual hold, or
        // base fallback, whichever applies right now (see resolveTarget()).
        target: resolveTarget(zs, now),
        overridden: isOverridden(zs, now),
        schedule: zs.schedule,
        currentTemp: hasReading ? reading.value : null,
        updatedAt: reading?.updatedAt ?? null,
        sensorOk: hasReading && !stale,
        calling: rt.calling,
        coolCalling: rt.coolCalling,
        safety: rt.safety,
        windowOpen: rt.windowOpen,
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
  coolModePin = gpioSvc.createPin(COOL_MODE_RELAY_PIN, 'out');
  coolModePin.writeSync(0);

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
  setAvailability,
  getAtticRelayCommands,
  ZONES,
};
