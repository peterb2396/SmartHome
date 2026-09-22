/**
 * Gas Boiler Service
 * ─────────────────────────────────────────────────────────────────
 * The gas boiler is a completely separate, 100%-isolated hydronic heating
 * PLANT — it shares no relay/actuator hardware with the air handler
 * (thermostat.js) — but as of the real re-piping work behind this revision,
 * it now serves the EXACT SAME 4-zone layout as the air handler: Primary
 * Suite, Upstairs, Downstairs, Office. This is a deliberate, load-bearing
 * fact, not a coincidence: ZONES below uses the IDENTICAL zone ids
 * thermostat.js does, specifically so the two systems can be treated as two
 * alternate PLANTS serving the SAME rooms (see thermostat.js's
 * getActiveSystem() for how the house picks which one is in charge — an
 * immediate read of `mode`, no seasonal prediction) rather than needing any
 * lossy name-based zone remapping — that remapping (Great Room <->
 * Downstairs/Primary Suite, etc.) is what this file and thermostat.js used
 * to need before the re-piping, and it's gone now that the zones genuinely
 * match. Each plant still keeps its own independent target/schedule/on
 * settings per zone — switching `mode` does not copy values between them,
 * it just changes which plant's own settings are actually driving relays.
 *
 * tempSensor per zone is `temp-<zoneId>` — the SAME sensorStore key the air
 * handler's own zone reads (see thermostat.js's ZONES). No new/separate
 * hardware is needed for the boiler to get real temperature data: once a
 * zone's RS485 sensor is wired up (see the Console's node setup), BOTH
 * plants serving that room see the same real reading automatically.
 * IMPORTANT, per explicit instruction: no zone has a real sensor wired up
 * yet. Until one exists for a given zone, tempSensor reads null there, and
 * the existing null-check in tick() below (unchanged) means that zone
 * NEVER calls for heat — this is intentional fail-safe behavior, not a
 * gap to fix; heat only ever activates once real temperature data confirms
 * it's actually needed.
 *
 * Each boiler zone has its own motorized zone valve (simple energize-to-
 * open, spring-return-closed — no proportional position, unlike the air
 * handler's dampers). There's no separate "burner enable" relay: the
 * boiler's own zone valves have end switches already bused together and
 * wired straight into the boiler's thermostat-call terminals, so the
 * boiler fires on its own once a valve is confirmed physically open — see
 * the wiring guide.
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
 * i2cRelay.js). Per direct confirmation against the real re-wired board:
 * channel 4 (CH5) Office zone valve, channel 5 (CH6) Primary Suite zone
 * valve, channel 6 (CH7) Upstairs zone valve, channel 7 (CH8) Downstairs
 * zone valve — i2cRelay.js's channel numbering is 0-indexed against the
 * board's own 1-indexed CH1-CH8 silkscreen (channel N = "CHN+1"), same
 * convention as every other board in this codebase (see DAMPER_BOARD/
 * AIR_HANDLER_BOARD in thermostat.js). Channels 0-3 (CH1-CH4) are spare —
 * confirm this exact mapping against the physical board (test each zone
 * individually) before trusting it fully; a wiring/channel error here
 * would energize the wrong zone's valve, this was inferred from a verbal
 * description of the board, not read directly off it.
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

// Confirmed via i2cdetect against real hardware (A1 jumper bridged) — same
// address as before the re-piping, only the zone wiring on this board
// changed, not the board itself.
const BOILER_BOARD = 0x22;
// Channel assignments per direct user confirmation of the real re-wired
// board (0-indexed here, matching the board's own 1-indexed CH5-CH8
// silkscreen positions — see this file's header and i2cRelay.js's channel
// convention). Genuinely worth re-confirming zone-by-zone against the
// physical hardware before trusting this fully — see header comment.
const CH = { OFFICE: 4, PRIMARY_SUITE: 5, UPSTAIRS: 6, DOWNSTAIRS: 7 };

// Same zone ids as thermostat.js's ZONES, on purpose — see this file's
// header. tempSensor reuses that exact same sensorStore key per zone, so
// once real RS485 hardware is wired up for a room, both plants serving it
// see the same real reading with no extra configuration.
const ZONES = [
  { id: 'primary-suite', label: 'Primary Suite', tempSensor: 'temp-primary-suite', ch: CH.PRIMARY_SUITE },
  { id: 'upstairs',      label: 'Upstairs',       tempSensor: 'temp-upstairs',      ch: CH.UPSTAIRS },
  { id: 'downstairs',    label: 'Downstairs',     tempSensor: 'temp-downstairs',    ch: CH.DOWNSTAIRS },
  { id: 'office',        label: 'Office',         tempSensor: 'temp-office',        ch: CH.OFFICE },
];

const DEFAULT_SETTINGS = {
  zones: Object.fromEntries(ZONES.map(z => [z.id, { on: true, target: 68, schedule: [], override: null }])),
};

function clampToSafetyRange(target) {
  return Math.min(SAFETY_MAX_F, Math.max(SAFETY_MIN_F, target));
}

const runtime = Object.fromEntries(
  ZONES.map(z => [z.id, { calling: false, safety: 'normal', envStatus: {}, callingSinceMs: 0, maxCallAlerted: false }])
);
let systemActive = false; // true only while thermostat.js's getActiveSystem() says 'boiler'

// Explicit backstop, independent of the stale-reading fix above — direct
// response to a real overnight incident where heat ran unbounded for
// hours. Catches ANY reason a zone might stay stuck calling that isn't
// "no fresh sensor data" specifically (a relay physically stuck on
// despite software saying it's off, a sensor reporting fresh-looking but
// wrong numbers, etc.) — a real home shouldn't need a single unbroken
// call this long even in genuinely cold weather with a properly sized
// system, so this is a deliberately generous threshold meant to catch
// "something is actually wrong," not to interrupt normal operation.
const MAX_CONTINUOUS_CALL_MS = 4 * 60 * 60 * 1000; // 4 hours

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
    // Real production incident: RS485 went down overnight; sensorStore kept
    // returning the LAST real reading it ever got (stale=true, but still a
    // number), and this check only ever treated a reading as "missing" if
    // it was literally absent — never if it was just old. That meant the
    // existing "no data, don't call for heat" fail-safe below never
    // engaged: every zone kept using its last-known-good temperature
    // forever, the boiler kept calling because that stale number still
    // read "too cold," and every relay stayed on all night with zero real
    // sensor data backing any of it. `stale` (sensorStore.js's own
    // freshness flag, 3 minutes) now counts as untrusted here too — once
    // the bus has been down long enough for a reading to go stale, this
    // zone falls into the currentTemp === null branch just like it always
    // should have, and heat cuts within one tick (worst case ~3.5 minutes
    // of total bus downtime, not all night).
    const currentTemp = typeof reading?.value === 'number' && !reading.stale ? reading.value : null;

    updateSafetyState(zone, rt, currentTemp);
    updateEnvironmentAlerts(zone.label, rt, readEnvironment(zone.id));

    if (currentTemp === null) {
      rt.calling = false;
      rt.callingSinceMs = 0;
      rt.maxCallAlerted = false;
      continue;
    }

    let heatCall = zs.on ? rt.calling : false;
    if (zs.on) {
      const target = resolveTarget(zs, now);
      if (!rt.calling && currentTemp < target - DEADBAND_F) heatCall = true;
      else if (rt.calling && currentTemp >= target + DEADBAND_F) heatCall = false;
    }
    if (rt.safety === 'below-min') heatCall = true; // freeze protection wins outright, on or off

    // Hard safety cutoff — see MAX_CONTINUOUS_CALL_MS's comment. Tracks
    // when THIS call started (a fresh false->true transition), and forces
    // the call off (with a one-time alert, reset once a fresh call starts
    // again later) if it's been running continuously for too long without
    // ever satisfying — independent of, and a backstop beyond, the stale-
    // reading fix above.
    if (heatCall && !rt.calling) {
      rt.callingSinceMs = now.valueOf();
    } else if (!heatCall) {
      rt.callingSinceMs = 0;
      rt.maxCallAlerted = false;
    }
    if (heatCall && rt.callingSinceMs && now.valueOf() - rt.callingSinceMs > MAX_CONTINUOUS_CALL_MS) {
      heatCall = false;
      if (!rt.maxCallAlerted) {
        rt.maxCallAlerted = true;
        sendPush(
          `${zone.label} (boiler zone) has been calling for heat continuously for over ${MAX_CONTINUOUS_CALL_MS / 3600000}h without ever satisfying — this usually means stale/bad sensor data or a stuck relay, not genuine demand. Forcing heat off as a safety cutoff; check this zone directly.`,
          'CRITICAL: Heat Call Safety Cutoff'
        );
      }
    }

    rt.calling = heatCall;
  }

  // ── TEMPORARY: only Upstairs has a real sensor node built so far — the
  // other 3 zones' `calling` is permanently false (see the currentTemp ===
  // null fail-safe above), so driving each zone off its OWN calling state
  // would only ever heat Upstairs, leaving the rest of the house cold.
  // Until Primary Suite/Downstairs/Office have real sensors of their own,
  // join all 4 relays to Upstairs's single call instead, so the whole
  // house heats together off the one zone that can actually see its own
  // temperature. DELETE this block (revert to each zone's own
  // `runtime[zone.id].calling`, i.e. `const on = systemActive &&
  // runtime[zone.id].calling;` inside the loop below) once the other 3
  // zones are wired up for real — this is explicitly a stopgap, not the
  // intended long-term per-zone behavior.
  const upstairsCalling = runtime.upstairs?.calling ?? false;
  for (const zone of ZONES) {
    const on = systemActive && upstairsCalling;
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
  shutdown,
  ZONES,
};
