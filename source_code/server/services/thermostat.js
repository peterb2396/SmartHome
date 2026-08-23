/**
 * Thermostat Service
 * ─────────────────────────────────────────────────────────────────
 * Multi-zone digital thermostat for the central air handler/condenser
 * (heating coil + heat pump + AC cooling, all one physical unit). The gas
 * boiler is a completely separate, isolated hydronic system — but as of
 * a real re-piping of the boiler's own plumbing, it now serves the SAME
 * 4-zone layout as this file (not a different one), so the two are two
 * alternate PLANTS for the same rooms rather than needing any zone-name
 * remapping — see boiler.js's header and getActiveSystem() below for how
 * the house immediately switches which plant is in charge (mode === 'gas'
 * means the boiler, full stop — no seasonal prediction, no target/schedule
 * copying between the two; each plant just keeps its own settings).
 *
 * Zones                Primary Suite, Upstairs, Office, Downstairs
 * Heat sources          gas (boiler — see boiler.js), electric (aux coil in
 *                       the air handler), air (heat pump mode of the
 *                       condenser)
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
 * ── Hardware ──────────────────────────────────────────────────────────
 * Every zone's temperature comes from its own RS485 node (rs485.js). All
 * relay control — zone dampers AND the air handler's 24V control wires —
 * runs over I2C relay boards (i2cRelay.js), not direct Pi GPIO. There are
 * two boards in play here:
 *
 *   DAMPER_BOARD (0x20)   8 channels, one open+close pair per zone. Channel
 *                         order matches the physical board left-to-right:
 *                         Primary Suite open/close, Upstairs open/close,
 *                         Downstairs open/close, Office open/close.
 *   AIR_HANDLER_BOARD (0x21)  7 of 8 terminal positions used, one per 24V
 *                         control wire, in the order they run left-to-right
 *                         off the terminal strip: red(R) orange(B)
 *                         yellow(Y1) green(G) blue(Y2) brown(W1) black(W2) —
 *                         CH8 is spare, and C is deliberately not run at all
 *                         (it's not required for any call to work — see the
 *                         wiring guide). This intentionally departs from the
 *                         ACiQ AHD's own wire-color convention (which uses
 *                         blue/brown/white for C/Y2/W1) — the function that
 *                         matters is whichever terminal a wire lands on at
 *                         each end, not its color, so this reordering is
 *                         just this project's own choice of which spare
 *                         wire-color slots to reuse for Y2/W1/W2 once C was
 *                         dropped. These names (R/B/Y1/G/Y2/W1/W2, plus C/W/
 *                         E-AUX/DH/DS/L which this build doesn't use) are the
 *                         AHU mainboard's own official terminal names, read
 *                         directly off its indoor-unit connector table and
 *                         24V Signal Chart — not a guess. Two things that
 *                         table corrected from earlier assumptions:
 *                         (1) B is energized DURING heat-pump HEATING, not
 *                         cooling — the opposite of a generic "O" terminal's
 *                         convention, and a real bug this codebase had until
 *                         it was cross-checked against the chart. (2) Y1/Y2
 *                         are labeled "Low Demand"/"High Demand", not simply
 *                         "stage 1/2" — same practical effect as this code's
 *                         staged usage. W1/W2 are two electric-aux-heat
 *                         stages; real 2-stage timing is implemented for
 *                         both Y1/Y2 and W1/W2 (see driveAirHandler(),
 *                         COMPRESSOR_STAGE2_DELAY_MS/ELECTRIC_STAGE2_DELAY_MS)
 *                         — stage 1 engages immediately on a call, stage 2
 *                         only joins if that call outlasts its delay running
 *                         on stage 1 alone, and always drops the instant
 *                         stage 1 does. IMPORTANT: on this board, W1/W2 are
 *                         electrically SHORTED TOGETHER by default (DIP
 *                         switch S4-4 = ON, the factory default) — meaning
 *                         the 2-stage electric timing this code implements
 *                         has NO effect on the equipment until S4-4 is
 *                         switched OFF (power off first) to actually
 *                         separate the two stages. No equivalent DIP switch
 *                         gates Y1/Y2 — those are independent inputs already.
 *                         All 6 non-R terminals used (B, Y1, Y2, G, W1, W2)
 *                         are real I2C-driven relay channels. R is NOT wired
 *                         through a relay at all: the air handler's internal
 *                         transformer supplies R as constant hot, and a
 *                         thermostat (or this board, standing in for one)
 *                         never generates its own 24VAC — it only switches R
 *                         through to whichever call wire needs it. So R
 *                         lands on the CH1 terminal purely as a junction
 *                         point, physically jumpered (plain wire, no relay)
 *                         to the COM terminal of the 6 switching relays.
 *                         Nothing in code ever touches R's channel — see
 *                         AH_CH's comment.
 *
 *                         IMPORTANT — this mode also needs, separately from
 *                         anything the Pi/relay board touches: (1) the AHU's
 *                         DIP switch SW1 position 1 set ON (all other SW1-4
 *                         positions OFF) to actually enable 8-wire/
 *                         conventional-thermostat fallback mode at all —
 *                         power must be off before changing DIP switches;
 *                         (2) a 2-wire S1/S2 Class-2 link run between the
 *                         AHU and the outdoor condenser (ODU) — this is
 *                         required in every mode, communicating or not, and
 *                         is normal HVAC-installer commissioning work, not
 *                         something this project's I2C board touches. See
 *                         the wiring guide for both.
 *
 * Damper actuation is proportional, not just open/closed: each zone tracks
 * an internal angle (0-90°), exposed as a 0-100% position. A call drives
 * the damper to that zone's configured `balancePercent` (default 100,
 * tunable per zone for airflow balancing — see setZoneBalance()); ending a
 * call always drives back to a hard 0%, never left partially open. Motor
 * spec is 60±0.5s for a full 0→100% traverse (`FULL_TRAVEL_SECONDS` per
 * zone below) — a partial move is timed proportionally
 * (|Δposition| / 100 * FULL_TRAVEL_SECONDS), same rate in both directions.
 * See driveDamper().
 *
 * Professional-grade control: short-cycle prevention on the compressor
 * (shortCycle.js), a reversing-valve-before-compressor sequencing delay so
 * the valve never flips under load, fan purge after a call ends, boot-time
 * damper homing (no position-feedback sensor exists, so every zone is
 * driven to a known 0% on startup rather than trusting a possibly-stale
 * remembered position), and graceful all-relays-off on SIGINT/SIGTERM.
 */

const moment      = require('moment');
const cron        = require('node-cron');
const sensors     = require('./sensorStore');
const settingsSvc = require('./settings');
const i2cRelay    = require('./i2cRelay');
const astro       = require('./astro');
const boiler      = require('./boiler');
const scheduleUtil = require('./scheduleUtil');
const { applyMinRunTime } = require('./shortCycle');
const { readEnvironment: readEnv, updateEnvironmentAlerts: updateEnvAlerts } = require('./envSensors');
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

// ── I2C board addresses ──────────────────────────────────────────────────────
// Each is a daisy-chained XL9535/PCA9535-compatible 8-channel board (see
// i2cRelay.js) — address set via that board's A0-A2 jumpers (0x20 default,
// no jumpers bridged). Confirmed via i2cdetect against real hardware.
const DAMPER_BOARD = 0x20;
const AIR_HANDLER_BOARD = 0x21;

// ── Zone / damper configuration ──────────────────────────────────────────────
// tempSensor is fed by that zone's RS485 node (rs485.js writes
// `temp-<zoneId>` once the node is configured on the Console's node
// registry with matching zoneId). openCh/closeCh are DAMPER_BOARD channel
// indexes (0-7) — order matches the physical board's left-to-right wiring.
// fullTravelSeconds is that zone's motor spec for a complete 0→100% sweep
// (60±0.5s nominal); tune per zone here if real motors/manufacturing
// variance calls for it — this is a hardware constant, not a runtime
// setting, same as openCh/closeCh.
const ZONES = [
  { id: 'primary-suite', label: 'Primary Suite', tempSensor: 'temp-primary-suite', openCh: 0, closeCh: 1, fullTravelSeconds: 61 },
  { id: 'upstairs',      label: 'Upstairs',       tempSensor: 'temp-upstairs',      openCh: 2, closeCh: 3, fullTravelSeconds: 61 },
  { id: 'downstairs',    label: 'Downstairs',     tempSensor: 'temp-downstairs',    openCh: 4, closeCh: 5, fullTravelSeconds: 61 },
  { id: 'office',        label: 'Office',         tempSensor: 'temp-office',        openCh: 6, closeCh: 7, fullTravelSeconds: 61 },
];

// Below this a partial correction isn't worth pulsing a relay for — avoids
// chattering the damper motor over a 1-2% rounding-sized difference.
const MIN_DAMPER_MOVE_PERCENT = 3;

// ── Air handler wire-color -> function map (AIR_HANDLER_BOARD channels) ─────
// Only B, Y1, Y2, G, W1, W2 are real, code-driven relay channels. R
// (terminal 0) is deliberately absent from this map — it's never switched,
// just physically jumpered on the terminal block (see the header comment
// above) — so there's nothing for code to reference for it. C isn't run at
// all in this build (not required for any call — see the wiring guide), and
// terminal 7 (CH8) is a genuine spare, also unreferenced. B is confirmed
// (against the AHU's own 24V Signal Chart) to be energized DURING heat-pump
// heating — not during cooling like a generic "O" terminal would be — see
// driveAirHandler()'s reversing-valve logic.
const AH_CH = { B: 1, Y1: 2, G: 3, Y2: 4, W1: 5, W2: 6 };

// Short-cycle protection + sequencing timing for the compressor.
const MIN_COMPRESSOR_ON_MS = 5 * 60 * 1000;
const MIN_COMPRESSOR_OFF_MS = 5 * 60 * 1000;
const REVERSING_VALVE_LEAD_MS = 5000; // valve only ever flips while the compressor is confirmed off
const FAN_PURGE_MS = 45 * 1000;       // keep the fan running this long after the last call ends

// Real 2-stage timing, not just mirroring stage 1: stage 2 (Y2/W2) only
// joins once stage 1 (Y1/W1) has been running continuously for this long
// without the call being satisfied — matching how a real 2-stage
// thermostat hands the equipment full capacity only once base capacity
// proves insufficient, rather than always running both stages together.
// Both drop the instant stage 1 does.
const COMPRESSOR_STAGE2_DELAY_MS = 20 * 60 * 1000; // 20 min — typical residential 2-stage compressor staging delay
const ELECTRIC_STAGE2_DELAY_MS = 15 * 60 * 1000;   // 15 min — aux electric heat stages up a bit sooner than the compressor

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
  // balancePercent: how far open this zone's damper drives while actively
  // calling — default fully open (100), tune down per zone for airflow
  // balancing (see setZoneBalance()). Ending a call always drives to 0
  // regardless of this value.
  zones: Object.fromEntries(ZONES.map(z => [z.id, { on: true, target: 68, schedule: [], override: null, balancePercent: 100 }])),
};

// ── Heat pump COP curve (efficiency drops as it gets colder outside) ────────
// Real manufacturer data — ACiQ 48K Central Ducted Air Handler (AHD) +
// 48K Standard Condenser (EHPD), 208-230V, from the extended heating
// performance table (heating capacity in BTU/hr, power input in kW),
// read at the 70°F indoor DB column (the middle of that table and a
// reasonable stand-in for a typical thermostat setpoint) and converted via
// COP = (BTU/hr ÷ 3412.142 BTU/hr-per-kW) ÷ kW input. Replace this array if
// you swap equipment or want to derive it from a different indoor design
// temp — everything else (interpolation, extrapolation past the ends)
// works the same regardless of how many points are here.
//
// Note this unit's real curve is NOT flat above ~47°F the way a generic
// assumption might guess — it keeps getting more efficient into the mid-60s
// — and it holds up much better in deep cold (COP ~1.6 at -13°F) than a
// naive "efficiency craters below freezing" guess would suggest. Sorted
// warmest-to-coldest to match copForOutdoorTemp()'s clamping logic.
const COP_CURVE = [
  { temp: 64.4, cop: 4.36 },
  { temp: 62,   cop: 4.15 },
  { temp: 59,   cop: 3.88 },
  { temp: 57,   cop: 3.72 },
  { temp: 52,   cop: 3.39 },
  { temp: 47,   cop: 3.12 },
  { temp: 44.6, cop: 2.90 },
  { temp: 42,   cop: 2.75 },
  { temp: 37,   cop: 2.34 },
  { temp: 35,   cop: 2.17 },
  { temp: 32,   cop: 2.15 },
  { temp: 27,   cop: 2.13 },
  { temp: 22,   cop: 2.11 },
  { temp: 17,   cop: 2.10 },
  { temp: 14,   cop: 2.08 },
  { temp: 5,    cop: 2.04 },
  { temp: 0,    cop: 1.90 },
  { temp: -4,   cop: 1.78 },
  { temp: -13,  cop: 1.63 },
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
// damperPercent is the last commanded/assumed position (0-100); damperMoving
// is 'opening' | 'closing' | null while a pulse is in flight — see
// driveDamper(). Starts at 0 (closed): init() immediately re-homes every
// zone for real on boot rather than trusting this default, since a restart
// could have occurred mid-motion and there's no physical position feedback.
const runtime = Object.fromEntries(
  ZONES.map(z => [z.id, {
    calling: false, coolCalling: false, safety: 'normal', envStatus: {},
    damperPercent: 0, damperMoving: null,
  }])
);

// Compressor short-cycle + reversing-valve sequencing state. lastOffAt
// starts at process-boot time (see init()) — a restart counts as "just
// turned off" for short-cycle purposes, so equipment can't be slammed
// straight back on ahead of its own minimum-off timer by a crash/restart.
const compressorState = { on: false, lastOnAt: 0, lastOffAt: 0 };
let reversingValveHeating = false; // is B (heating reversing valve) energized — only ever changed while compressor is off
const fanState = { on: false, purgeUntil: 0 };
// Tracks when W1 (stage 1 electric heat) most recently turned on, purely
// for the stage-2 escalation timer — no short-cycle protection on the
// electric elements (matches original behavior, resistive heat has none
// of a compressor's cycling concerns).
const electricState = { on: false, onAt: 0 };

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

// ── Schedule resolution (shared with boiler.js) ──────────────────────────────
const { resolveTarget, isOverridden, nextBoundary } = scheduleUtil;

// ── Safety floor/ceiling ──────────────────────────────────────────────────────
// Uses the same deadband-hysteresis shape as comfort calls so it doesn't
// short-cycle right at the boundary. Pushes on every state transition —
// into a violation, and back out of one — since "did the response actually
// work" matters as much as the initial alert. In normal operation this
// should essentially never trip, since comfort logic already keeps zones
// well inside 60-75°F — if it does trip, something's actually wrong
// (equipment down, sensor lag, extreme weather overwhelming capacity).
// ── Environmental sensors (RS485 zone nodes: BME680 + SCD41) ───────────────
// Read/classify/alert logic lives in envSensors.js (shared with boiler.js).
function readEnvironment(zone) {
  return readEnv(zone.id);
}

function updateEnvironmentAlerts(zone, rt, env) {
  return updateEnvAlerts(zone.label, rt, env);
}

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

// ── Active plant selection (air handler vs. boiler) ─────────────────────
// The boiler and air handler now serve the exact same 4 zones (Primary
// Suite, Upstairs, Downstairs, Office — see boiler.js's header for why),
// so which one is "in charge" is a straight, immediate read of `mode` —
// no outdoor-temp prediction, no lookahead, no handoff step. Gas mode means
// the boiler is the house's sole heat source, full stop; anything else
// means the air handler is. Each plant keeps its own independent zone
// settings (target/schedule/on), so switching modes does not copy or
// overwrite either side's values — whichever plant becomes active simply
// resumes using whatever it was last set to. (The '3zone'/'4zone' string
// values below are historical internal labels, kept as-is rather than
// renamed — both plants are 4-zone now, but these tokens are never
// displayed to a user directly, only compared against internally and by
// the frontend's activeSystem check.)
function getActiveSystem(settings) {
  return settings.mode === 'gas' ? '3zone' : '4zone';
}

// ── Control loop ─────────────────────────────────────────────────────────────
async function tick() {
  const settings = getSettings();
  const now = moment();

  const activeSystem = getActiveSystem(settings);
  boiler.setSystemActive(activeSystem === '3zone');

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
  //
  // When the 3-zone boiler system is active, the air handler's 4 zones
  // still track their own temps/safety state (so nothing looks broken/dead
  // in the UI) but never actually call for heat via air/electric — gas mode
  // means the boiler is the exclusive heat source for the house right now.
  const airHandlerIsHeatSource = activeSystem === '4zone';

  for (const zone of ZONES) {
    const zs = settings.zones[zone.id];
    const rt = runtime[zone.id];

    const reading = sensors.get(zone.tempSensor);
    const currentTemp = typeof reading?.value === 'number' ? reading.value : null;

    updateSafetyState(zone, rt, currentTemp, settings);
    updateEnvironmentAlerts(zone, rt, readEnvironment(zone));

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

    if (!airHandlerIsHeatSource) heatCall = false; // boiler has the house's heat right now — cooling can still run

    rt.calling = heatCall;
    rt.coolCalling = coolCall;
  }

  // Pass 2: system-wide arbitration + relay writes. A heat pump can't heat
  // and cool at once — if any zone needs safety cooling, that wins, and
  // zone dampers that would only be open for an "air"-sourced heat call
  // stay closed this tick rather than get cold air pushed into them.
  const activeSource = resolveActiveSource(settings);
  const anyCooling = ZONES.some(z => runtime[z.id].coolCalling);
  const anyHeatCalling = ZONES.some(z => runtime[z.id].calling);
  const airHandlesHeat = activeSource === 'air';

  for (const zone of ZONES) {
    const zs = settings.zones[zone.id];
    const rt = runtime[zone.id];
    const heatSuppressed = rt.calling && anyCooling && airHandlesHeat;
    const wantOpen = (rt.calling && !heatSuppressed) || rt.coolCalling;
    driveDamper(zone, rt, wantOpen, zs.balancePercent ?? 100);
  }

  driveAirHandler(settings, activeSource, anyCooling, anyHeatCalling, Date.now());
}

// Proportional damper actuation over I2C: drives toward `targetPercent`
// while calling, or hard to 0% once the call ends (never left partially
// open — see the module header). Won't interrupt an in-flight pulse
// (no position feedback, so reversing mid-travel is avoided — the next
// tick re-evaluates once the current move finishes) and skips moves smaller
// than MIN_DAMPER_MOVE_PERCENT to avoid chattering the motor over rounding
// noise.
function driveDamper(zone, rt, wantOpen, targetPercent) {
  if (rt.damperMoving) return;

  const desired = wantOpen ? Math.max(0, Math.min(100, targetPercent)) : 0;
  const delta = desired - rt.damperPercent;
  if (Math.abs(delta) < MIN_DAMPER_MOVE_PERCENT) return;

  const opening = delta > 0;
  const ch = opening ? zone.openCh : zone.closeCh;
  const otherCh = opening ? zone.closeCh : zone.openCh;
  const durationMs = Math.round((Math.abs(delta) / 100) * zone.fullTravelSeconds * 1000);

  i2cRelay.setChannel(DAMPER_BOARD, otherCh, false); // hard interlock — never both relays energized at once
  i2cRelay.setChannel(DAMPER_BOARD, ch, true);
  rt.damperMoving = opening ? 'opening' : 'closing';
  console.log(`[Thermostat] ${zone.label} damper ${rt.damperMoving} ${rt.damperPercent}% -> ${desired}% (${(durationMs / 1000).toFixed(1)}s pulse)`);

  setTimeout(() => {
    i2cRelay.setChannel(DAMPER_BOARD, ch, false);
    rt.damperPercent = desired;
    rt.damperMoving = null;
    console.log(`[Thermostat] ${zone.label} damper now ${desired}%`);
  }, durationMs);
}

// Drives Y1 immediately, then escalates to Y2 only once Y1 has been
// running continuously for COMPRESSOR_STAGE2_DELAY_MS (see that constant's
// comment) — real 2-stage timing, not just mirroring. Y2 always drops the
// instant Y1 does, since there's no reason to hold stage 2 alone.
function setCompressorChannels(on, now) {
  i2cRelay.setChannel(AIR_HANDLER_BOARD, AH_CH.Y1, on);
  const stage2On = on && (now - compressorState.lastOnAt >= COMPRESSOR_STAGE2_DELAY_MS);
  i2cRelay.setChannel(AIR_HANDLER_BOARD, AH_CH.Y2, stage2On);
}

// Same staged-escalation idea for the two electric aux-heat elements — W1
// alone covers most calls, W2 only joins once a call has outlasted
// ELECTRIC_STAGE2_DELAY_MS running on W1 alone. Tracks its own on-time
// separately from compressorState since electric heat isn't short-cycle
// gated (see electricState's comment).
function setElectricChannels(on, now) {
  if (on && !electricState.on) electricState.onAt = now;
  electricState.on = on;
  i2cRelay.setChannel(AIR_HANDLER_BOARD, AH_CH.W1, on);
  const stage2On = on && (now - electricState.onAt >= ELECTRIC_STAGE2_DELAY_MS);
  i2cRelay.setChannel(AIR_HANDLER_BOARD, AH_CH.W2, stage2On);
}

// Air handler control: compressor (Y1/Y2, staged) with short-cycle
// prevention, the reversing valve (B) which only ever moves while the
// compressor is confirmed off (flipping it under load wears/damages it),
// the aux electric coil (W1/W2, staged the same way), and the fan (G) with
// a purge period after the last call ends. R and C are the transformer
// hot/common feed — jumpered, never touched here (see the module header
// comment).
function driveAirHandler(settings, activeSource, anyCooling, anyHeatCalling, now) {
  const wantHeatViaAir = anyHeatCalling && activeSource === 'air' && !anyCooling;
  const wantCompressor = (anyCooling || wantHeatViaAir) && settings.available.air !== false;
  const wantElectric = anyHeatCalling && activeSource === 'electric' && settings.available.electric !== false;

  // B ("Heating Reversing Valve" on this unit's board — confirmed energized
  // DURING heat-pump heating, not during cooling, against the AHU's own
  // 24V Signal Chart) may only move while the compressor is physically
  // off. If a mode flip is needed, shut the compressor down first (subject
  // to its own minimum-on-time) and let the valve flip on a later tick once
  // REVERSING_VALVE_LEAD_MS has actually elapsed since it went off. Only
  // driven for actual heat-via-air calls (not cooling, not idle, not
  // electric-only) — de-energized is already the correct resting state for
  // everything except an active heat-pump-heating call, so there's no
  // reason to hold the coil energized outside of one.
  if (wantHeatViaAir !== reversingValveHeating) {
    if (compressorState.on) {
      applyMinRunTime(compressorState, false, now, MIN_COMPRESSOR_ON_MS, 0);
      setCompressorChannels(compressorState.on, now);
    } else if (now - compressorState.lastOffAt >= REVERSING_VALVE_LEAD_MS) {
      reversingValveHeating = wantHeatViaAir;
      i2cRelay.setChannel(AIR_HANDLER_BOARD, AH_CH.B, reversingValveHeating);
    }
  } else {
    const valveSettled = now - compressorState.lastOffAt >= REVERSING_VALVE_LEAD_MS;
    const on = applyMinRunTime(
      compressorState,
      wantCompressor && (compressorState.on || valveSettled),
      now, MIN_COMPRESSOR_ON_MS, MIN_COMPRESSOR_OFF_MS
    );
    setCompressorChannels(on, now);
  }

  setElectricChannels(wantElectric, now);

  // Fan: on immediately whenever the compressor or aux coil is actually
  // running, held on for a purge period after both stop.
  const wantFanNow = compressorState.on || wantElectric;
  if (wantFanNow) {
    fanState.on = true;
    fanState.purgeUntil = 0;
    i2cRelay.setChannel(AIR_HANDLER_BOARD, AH_CH.G, true);
  } else if (fanState.on) {
    if (!fanState.purgeUntil) fanState.purgeUntil = now + FAN_PURGE_MS;
    if (now >= fanState.purgeUntil) {
      fanState.on = false;
      i2cRelay.setChannel(AIR_HANDLER_BOARD, AH_CH.G, false);
    }
  }
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
// The COP curve only has real data from -13°F to 64.4°F (the manufacturer's
// tested operating range for this unit). When the true crossover falls
// outside that range, we still report a number by
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
    modelEdge,    // the modeled boundary (64.4 or -13) when outOfRange is set, else null
  };
}

// Gas vs. heat pump cost comparison at today's actual outdoor temp average
// (as opposed to computeCrossover(), which answers "at what temperature do
// they tie" independent of the weather). This answers "right now, how much
// more does the losing option cost" — e.g. "heat pump would cost 13% more
// (ex: $100 for gas, $113 for heat pump)". Same avgOutdoorTempF fallback as
// resolveActiveSource() so this stays in sync with whatever source is
// actually running.
function computeCostComparison(settings) {
  const avgOutdoorTempF = settings.lastDecision?.avgOutdoorTempF ?? 40;
  const gasCost = costPerUnit('gas', avgOutdoorTempF, settings.rates);
  const airCost = costPerUnit('air', avgOutdoorTempF, settings.rates);
  const cheaper = gasCost <= airCost ? 'gas' : 'air';
  const cheaperCost = cheaper === 'gas' ? gasCost : airCost;
  const pricierCost = cheaper === 'gas' ? airCost : gasCost;
  const pricier = cheaper === 'gas' ? 'air' : 'gas';
  const pctMoreExpensive = Math.round(((pricierCost / cheaperCost) - 1) * 100);
  return {
    avgOutdoorTempF,
    cheaper,
    pricier,
    pctMoreExpensive,
    // A fixed $100 basis for the cheaper source makes the comparison
    // concrete without pretending to know the household's actual usage.
    cheaperExampleCost: 100,
    pricierExampleCost: Math.round(100 * (pricierCost / cheaperCost)),
  };
}

const PLANT_SOURCES = ['gas', 'electric', 'air'];

// Cheapest source among those not marked unavailable. Electric is the
// manual backup — it only wins here if gas/air are both down, since its
// cost is otherwise always the highest (COP fixed at 1, see costPerUnit).
function pickAvailableSource(costs, available) {
  const eligible = PLANT_SOURCES.filter(s => available[s] !== false);
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
  // Re-evaluate right away instead of waiting up to TICK_MS for the next
  // scheduled loop — a manual change should take effect (relay included)
  // the moment it's saved, not on the next interval tick.
  await tick();
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
  // Same reasoning as setZone() — if "now" falls inside one of the blocks
  // just saved, that target (and the relay) should take hold immediately,
  // not whenever the next 30s tick happens to land.
  await tick();
  return next;
}

// Per-zone damper balance — how far open (0-100%) this zone drives while
// actively calling. Purely an airflow-tuning knob; ending a call always
// still drives to a hard 0% regardless of this value (see driveDamper()).
async function setZoneBalance(zoneId, balancePercent) {
  const settings = getSettings();
  if (!settings.zones[zoneId]) throw new Error(`Unknown zone ${zoneId}`);
  if (typeof balancePercent !== 'number' || balancePercent < 0 || balancePercent > 100) {
    throw new Error('balancePercent must be a number between 0 and 100');
  }
  const zs = { ...settings.zones[zoneId], balancePercent };
  const next = { ...settings, zones: { ...settings.zones, [zoneId]: zs } };
  await saveSettings(next);
  await tick();
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
  // A mode change can flip which zone system is active (see
  // getActiveSystem()) — re-evaluate right away so the swap (and its
  // temperature mapping) happens the moment this is saved, not up to
  // TICK_MS later.
  await tick();
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
  if (!PLANT_SOURCES.includes(source)) throw new Error(`Unknown source ${source}`);
  const settings = getSettings();
  const nextAvailable = { ...settings.available, [source]: available };
  const nextMode = (!available && settings.mode === source) ? 'auto' : settings.mode;
  const next = { ...settings, available: nextAvailable, mode: nextMode };
  await saveSettings(next);
  return next;
}

function getState() {
  const settings = getSettings();
  const activeSystem = getActiveSystem(settings);
  // Pulled once per getState() call (not per-zone) so the dial and web app
  // both see a single consistent snapshot of which plant is actually serving
  // each zone right now — see the `calling`/`heatSource` fields below, which
  // is how "nothing is ever stale" between the two UIs holds even right
  // after a mode change flips which plant is active.
  const boilerState = boiler.getState();
  return {
    mode: settings.mode,
    activeSource: resolveActiveSource(settings),
    activeSystem, // '4zone' | '3zone' — which plant is actually live right now
    lastDecision: settings.lastDecision,
    rates: settings.rates,
    available: settings.available,
    safetyRange: { min: SAFETY_MIN_F, max: SAFETY_MAX_F },
    crossover: computeCrossover(settings.rates),
    costComparison: computeCostComparison(settings),
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
      const boilerZone = boilerState.zones.find(z => z.id === zone.id);
      return {
        id: zone.id,
        label: zone.label,
        on: zs.on,
        // The currently-effective target — schedule block, manual hold, or
        // base fallback, whichever applies right now (see resolveTarget()).
        target: resolveTarget(zs, now),
        overridden: isOverridden(zs, now),
        // Only meaningful while overridden is true. null both when there's
        // no active override AND when the override has no expiry (an empty
        // schedule — nextBoundary() has nothing to hand off to, so the hold
        // is indefinite) — the frontend uses this to decide whether a
        // "Manual override until next schedule" countdown makes sense to
        // show at all.
        overrideUntil: zs.override?.untilTime ?? null,
        schedule: zs.schedule,
        currentTemp: hasReading ? reading.value : null,
        updatedAt: reading?.updatedAt ?? null,
        sensorOk: hasReading && !stale,
        // Unified across both plants — whichever one is actually serving this
        // zone right now — so the web app and every dial read a single truth
        // and never show a stale/contradictory calling state during a handoff.
        calling: activeSystem === '4zone' ? rt.calling : (boilerZone?.calling ?? false),
        heatSource: activeSystem === '4zone' ? 'air-handler' : 'boiler',
        coolCalling: rt.coolCalling,
        safety: rt.safety,
        environment: readEnvironment(zone),
        balancePercent: zs.balancePercent ?? 100,
        damperPercent: rt.damperPercent,
        damperMoving: rt.damperMoving,
      };
    }),
  };
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
// De-energize everything on a planned stop/restart rather than leaving
// relays (compressor, valves, dampers mid-pulse) energized. Damper timers
// in flight are simply superseded — whatever position they were driving
// toward gets abandoned in favor of "off", and boot-time homing on the next
// start re-establishes a known 0% regardless.
function shutdown(signal) {
  console.log(`[Thermostat] ${signal} received — de-energizing all relays.`);
  i2cRelay.allOff();
  process.exit(0);
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (!settingsSvc.get()?.thermostat) {
    await saveSettings(DEFAULT_SETTINGS);
  }

  i2cRelay.init();
  boiler.init();

  // Closes a real startup gap: i2cRelay.js only zeroes a board's registers
  // the first time setChannel() is ever called for that address, and
  // AIR_HANDLER_BOARD's first-ever call used to be inside driveAirHandler()
  // — which only runs from tick(), which doesn't fire until TICK_MS after
  // boot (setInterval, not an immediate call). Meanwhile the PCA9535-family
  // chip these boards use defaults every pin to INPUT mode at power-on,
  // with an internal ~100kΩ pull-up on each pin — so every channel floats
  // HIGH (energized, since these boards are active-high) from the moment
  // the 24V bus powers up until Node finally touches that address. Damper/
  // boiler boards never showed this because they're both zeroed a few
  // lines below/in boiler.init() — synchronously, within the same startup
  // burst — closing their version of this same gap in milliseconds instead
  // of leaving it open for TICK_MS. Real-world effect before this fix: the
  // reversing valve, both heat stages, and the fan all sat energized
  // together on every single restart — a combination that should never
  // happen even briefly on a real air handler.
  for (const ch of Object.values(AH_CH)) i2cRelay.setChannel(AIR_HANDLER_BOARD, ch, false);

  // R and C are physically jumpered, not relay-switched — see AH_CH's
  // comment — so there's nothing to energize here for them.

  const now = Date.now();
  compressorState.lastOffAt = now; // boot counts as "just turned off" for short-cycle purposes
  compressorState.lastOnAt = 0;

  // Boot-time damper homing: no physical position feedback exists, so
  // rather than trust whatever damperPercent defaulted to in memory, every
  // zone gets a real full-length close pulse on startup to guarantee an
  // actual, known 0% before the control loop starts making relative moves
  // off of it.
  for (const zone of ZONES) {
    i2cRelay.setChannel(DAMPER_BOARD, zone.openCh, false);
    i2cRelay.setChannel(DAMPER_BOARD, zone.closeCh, true);
    console.log(`[Thermostat] ${zone.label} damper homing to 0% (${zone.fullTravelSeconds}s)`);
    setTimeout(() => {
      i2cRelay.setChannel(DAMPER_BOARD, zone.closeCh, false);
      runtime[zone.id].damperPercent = 0;
      console.log(`[Thermostat] ${zone.label} damper homed.`);
    }, zone.fullTravelSeconds * 1000);
  }

  const settings = getSettings();
  const today = moment().format('YYYY-MM-DD');
  if (settings.lastDecision?.date !== today) {
    await runCostDecision();
  }

  boiler.setSystemActive(getActiveSystem(getSettings()) === '3zone');

  setInterval(() => { tick().catch(err => console.error('[Thermostat] Tick error:', err.message)); }, TICK_MS);

  cron.schedule('0 0 * * *', async () => {
    console.log('[Thermostat] Midnight cost decision');
    await runCostDecision();
  }, CRON_OPTS);

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('[Thermostat] Initialized.');
}

module.exports = {
  init,
  getState,
  setZone,
  setZoneSchedule,
  setZoneBalance,
  setMode,
  setRates,
  setAvailability,
  getActiveSystem,
  getSettings,
  ZONES,
};
