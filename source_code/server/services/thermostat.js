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
 *        that block specifies. See resolveTarget()/nextBoundary().
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
  // activeSource is intentionally NOT stored — see resolveActiveSource().
  lastDecision: null,      // { date, costs, avgOutdoorTempF, cheapest } — informational only
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
function matchingBlock(schedule, now) {
  const dow = now.day();
  const hm = now.format('HH:mm');
  const matches = (schedule || []).filter(
    b => (b.day === dow || b.day === 'all') && hm >= b.start && hm < b.end
  );
  return matches.length ? matches[matches.length - 1] : null;
}

// When does "right now" — whichever block (or gap between blocks) we're
// currently in — end? A manual hold created now should last exactly until
// this absolute moment, then release. Returns an ISO string, or null if the
// schedule has no blocks at all (nothing to hand off to, ever — hold stands
// until manually changed again).
//
// This MUST be an absolute timestamp rather than a "which block/gap is this"
// identity — a gap has no distinguishing features of its own (any gap looks
// like any other gap), so identity-based comparison would let a hold set
// during one gap silently reactivate during a LATER, unrelated gap once
// enough real time had passed for it to roll around again. An absolute
// expiry moment can only ever be crossed once, since time only moves forward.
function nextBoundary(schedule, now) {
  const active = matchingBlock(schedule, now);
  if (active) {
    const [hh, mm] = active.end.split(':').map(Number);
    return moment(now).hours(hh).minutes(mm).seconds(0).milliseconds(0).toISOString();
  }
  // In a gap — find the soonest upcoming block start, scanning up to a week
  // ahead (covers day-specific blocks that haven't come around yet).
  let soonest = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const day = moment(now).add(dayOffset, 'days');
    const dow = day.day();
    for (const b of (schedule || [])) {
      if (b.day !== 'all' && b.day !== dow) continue;
      const [hh, mm] = b.start.split(':').map(Number);
      const startMoment = moment(day).hours(hh).minutes(mm).seconds(0).milliseconds(0);
      if (startMoment.isAfter(now) && (!soonest || startMoment.isBefore(soonest))) {
        soonest = startMoment;
      }
    }
  }
  return soonest ? soonest.toISOString() : null;
}

function overrideActive(zoneSettings, now) {
  const ov = zoneSettings.override;
  if (!ov) return false;
  return !ov.untilTime || moment(now).isBefore(ov.untilTime);
}

// The target actually in effect right now: a manual hold (if one is set and
// hasn't reached its expiry moment yet), else whatever the schedule says for
// this moment, else the zone's base target.
function resolveTarget(zoneSettings, now) {
  if (overrideActive(zoneSettings, now)) return zoneSettings.override.target;
  const block = matchingBlock(zoneSettings.schedule, now);
  return block ? block.target : (zoneSettings.target ?? 68);
}

function isOverridden(zoneSettings, now) {
  return overrideActive(zoneSettings, now);
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
  //
  // Important: resolveTarget()'s result is NEVER written back to the base
  // `target` here. A schedule block is a purely temporary window — it must
  // have zero lasting effect on the base value, so that once it ends (and
  // no other block immediately follows), the zone reverts to whatever the
  // base was before the block ever started. Only an explicit manual change
  // (setZone) is allowed to update the base — see its comment for why a
  // manual hold is different (it's meant to persist as the new baseline).
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
  const activeSource = resolveActiveSource(settings);
  const anyCooling = ZONES.some(z => runtime[z.id].coolCalling);
  const airHandlesHeat = activeSource === 'air';

  for (const zone of ZONES) {
    const rt = runtime[zone.id];
    const heatSuppressed = rt.calling && anyCooling && airHandlesHeat;
    writeZoneRelay(zone, (rt.calling && !heatSuppressed) || rt.coolCalling);
  }

  drivePlantRelays(settings, activeSource, anyCooling);
}

function writeZoneRelay(zone, on) {
  if (zone.node === 'basement') {
    basementZonePins[zone.id]?.writeSync(on ? 1 : 0);
  } else {
    atticRelayCommands[zone.relayName] = on;
  }
}

function drivePlantRelays(settings, activeSource, anyCooling) {
  const anyHeatCalling = ZONES.some(z => runtime[z.id].calling);
  const airHandlesHeat = activeSource === 'air';

  for (const source of Object.keys(PLANT_RELAYS)) {
    let on;
    if (source === 'air') {
      const wantsHeatViaAir = anyHeatCalling && airHandlesHeat && !anyCooling;
      // Hard invariant: a source marked unavailable (being serviced) NEVER
      // gets energized, no matter what activeSource/mode says elsewhere —
      // this is the one place actual heating hardware gets switched on.
      on = (anyCooling || wantsHeatViaAir) && settings.available.air !== false;
    } else {
      on = anyHeatCalling && activeSource === source && settings.available[source] !== false;
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
//
// The COP curve only has real data from -10°F to 47°F (heat pumps plateau
// above 47°F and typically don't run at all much below -10°F). When the
// true crossover falls outside that range, we still report a number by
// extending the line through the two nearest curve points — flagged via
// `outOfRange` so the UI can caveat it as extrapolated — rather than
// collapsing to a flat "always cheaper" the moment the real crossover walks
// past the edge of the modeled data. A cent of difference in gas price can
// legitimately push the crossover from 46.8°F to 51°F; it shouldn't look
// like the number vanished, just that it's now off the edge of the chart.
function computeCrossover(rates) {
  const gasCost = costPerUnit('gas', null, rates);
  const targetCop = rates.elecPricePerKwh / gasCost;
  const best = COP_CURVE[0];                      // warmest modeled point -> highest COP -> air cheapest here
  const worst = COP_CURVE[COP_CURVE.length - 1];   // coldest modeled point -> lowest COP -> air priciest here

  const lerpTemp = (a, b, cop) => {
    const frac = (a.cop - cop) / (a.cop - b.cop);
    return a.temp - frac * (a.temp - b.temp);
  };

  let tempF, outOfRange = null, modelEdge = null;
  if (targetCop >= best.cop) {
    tempF = lerpTemp(COP_CURVE[0], COP_CURVE[1], targetCop);
    outOfRange = 'above';
    modelEdge = best.temp;
  } else if (targetCop <= worst.cop) {
    tempF = lerpTemp(COP_CURVE[COP_CURVE.length - 2], COP_CURVE[COP_CURVE.length - 1], targetCop);
    outOfRange = 'below';
    modelEdge = worst.temp;
  } else {
    for (let i = 0; i < COP_CURVE.length - 1; i++) {
      const a = COP_CURVE[i], b = COP_CURVE[i + 1];
      if (targetCop <= a.cop && targetCop >= b.cop) {
        tempF = lerpTemp(a, b, targetCop);
        break;
      }
    }
  }

  return {
    tempF: Math.round(tempF * 10) / 10,
    warmerIsCheaper: 'air',
    colderIsCheaper: 'gas',
    outOfRange,   // null | 'above' | 'below' — whether tempF is extrapolated past the modeled range
    modelEdge,    // the modeled boundary (47 or -10) when outOfRange is set, else null
  };
}

// Cheapest source among those not marked unavailable. Electric is the
// manual backup — it only wins here if gas/air are both down, since its
// cost is otherwise always the highest (COP fixed at 1, see costPerUnit).
function pickAvailableSource(costs, available) {
  const eligible = Object.keys(PLANT_RELAYS).filter(s => available[s] !== false);
  if (eligible.length === 0) return null; // everything marked unavailable — caller decides fallback
  return eligible.sort((a, b) => costs[a] - costs[b])[0];
}

// Which source is actually driving heat right now. In 'auto' mode this is
// NOT a cached/persisted value — it's recomputed on every call from the
// current rates and the last known daily forecast average, so changing a
// rate (or marking a source unavailable) takes effect immediately and
// can't get stuck waiting on an async decision job that may not have run
// (or may have failed, e.g. a flaky weather API call). Only the outdoor
// temperature average is actually weather-dependent and needs a network
// call — that's refreshed once a day by runCostDecision(); the cost
// comparison itself is pure arithmetic and cheap enough to redo every time.
function resolveActiveSource(settings) {
  if (settings.mode !== 'auto') return settings.mode;
  const avgOutdoorTempF = settings.lastDecision?.avgOutdoorTempF ?? 40;
  const costs = {
    gas: costPerUnit('gas', avgOutdoorTempF, settings.rates),
    electric: costPerUnit('electric', avgOutdoorTempF, settings.rates),
    air: costPerUnit('air', avgOutdoorTempF, settings.rates),
  };
  return pickAvailableSource(costs, settings.available) ?? 'gas';
}

// Refreshes the one genuinely weather-dependent input — today's average
// forecast temperature — and stores a same-moment cost snapshot purely for
// the "Auto-selected for {date}..." display line. Does NOT decide
// activeSource; that's resolveActiveSource()'s job, computed live.
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
    const cheapestAvailable = pickAvailableSource(costs, settings.available) ?? 'gas';

    const next = {
      ...settings,
      lastDecision: {
        date: moment(today).format('YYYY-MM-DD'),
        costs,
        avgOutdoorTempF: Math.round(avgOutdoorTempF * 10) / 10,
        cheapest: cheapestAvailable,
      },
    };
    await saveSettings(next);
    console.log(`[Thermostat] Forecast refreshed: avg ${next.lastDecision.avgOutdoorTempF}°F, cheapest=${cheapestAvailable}`, costs);
  } catch (err) {
    console.error('[Thermostat] Forecast refresh error:', err.message);
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
    // Manually nudging the target creates a hold that lasts exactly until
    // whichever block (or gap) is active right now ends — see
    // nextBoundary()/resolveTarget(). Also mirrored into the base `target`
    // above, so if the schedule is empty (nextBoundary has nothing to hand
    // off to) the held value sticks around as the new baseline instead of
    // reverting to whatever it was before.
    zs.override = { target: clamped, untilTime: nextBoundary(zs.schedule, moment()) };
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
  // activeSource is derived live by resolveActiveSource() — nothing else to store here.
  const next = { ...settings, mode };
  await saveSettings(next);
  return next;
}

async function setRates(rates) {
  const settings = getSettings();
  const next = { ...settings, rates: { ...settings.rates, ...rates } };
  await saveSettings(next);
  // No re-decision needed — activeSource is resolved live from whatever
  // rates are currently saved (see resolveActiveSource()), so this takes
  // effect on the very next read, with no dependency on a weather API call.
  return next;
}

// Mark a heat source as being serviced (or back in service). If it was the
// manually-selected mode, fall back to auto rather than staying pinned to
// something that can't actually run — auto's live cost comparison already
// excludes unavailable sources, so no separate failover math is needed here.
async function setAvailability(source, available) {
  if (!PLANT_RELAYS[source]) throw new Error(`Unknown source ${source}`);
  const settings = getSettings();
  const nextAvailable = { ...settings.available, [source]: available };
  const nextMode = (!available && settings.mode === source) ? 'auto' : settings.mode;
  const next = { ...settings, available: nextAvailable, mode: nextMode };
  await saveSettings(next);
  return next;
}

function getState() {
  const settings = getSettings();
  return {
    mode: settings.mode,
    activeSource: resolveActiveSource(settings),
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
