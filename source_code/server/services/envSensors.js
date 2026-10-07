/**
 * Environmental Sensor Classification
 * ─────────────────────────────────────────────────────────────────
 * Shared by thermostat.js (4-zone air handler), boiler.js (its matching
 * 4 zones), and monitorZones.js (basement/attic) — one read/classify/
 * alert implementation for all of them, since they all read through the
 * same `<type>-<zoneId>` sensorStore convention. Hardware is NOT uniform
 * across zones, though: thermostat/boiler zones only ever carry an SCD41
 * (co2 only — no BME680 on those nodes), while basement/attic carry a
 * full BME680 + SCD41 (humidity/pressure/voc/co2). That's fine as-is —
 * every field here already reads as `null`/"no reading" when a zone's
 * node doesn't report that type, the same graceful path any not-yet-wired
 * sensor takes, so nothing about this file needs to special-case which
 * zones have which chips. Pressure has no safety implication — read and
 * displayed, never classified.
 */

const sensors = require('./sensorStore');
const { sendPush } = require('./mail');

// humidity is a comfort/mold-prevention band, not an acute hazard, so it
// only has one "warn" tier. co2/voc use standard indoor-air-quality tiers.
const ENV_RANGES = {
  // hysteresis: once humidity has crossed INTO warn (past 30/50), it has
  // to cross back past an inner margin (32/48) to clear again, not just
  // re-touch the original line. Without this, a reading sitting right at
  // the boundary (e.g. hovering at 49.8/50.1/49.9/50.2...) flips the
  // status back and forth every single tick — and since
  // updateEnvironmentAlerts() below pushes on every status CHANGE, that
  // meant a push notification per flip. See classifyEnv()'s own comment
  // for how this is applied.
  humidity: { warnLow: 30, warnHigh: 50, hysteresis: 2 },  // %RH
  co2:      { warn: 1000, danger: 2000 },   // ppm
  voc:      { warn: 50, danger: 25 },       // 0-100 heuristic score, higher = cleaner (see rs485_node.ino)
};

// `wasWarn` — this type's PREVIOUS status for the same zone, if the
// caller is tracking one (see readEnvironment()'s own comment) — lets
// humidity apply the hysteresis band above: already-'warn' uses the
// tighter inner thresholds to decide whether it's really cleared yet,
// everything else (first reading, or already 'ok') uses the plain
// 30/50 line. co2/voc are unaffected — not what was asked for here, and
// their existing warn/danger split isn't reported as flapping.
function classifyEnv(type, value, wasWarn = false) {
  if (typeof value !== 'number') return null;
  if (type === 'humidity') {
    const { warnLow, warnHigh, hysteresis } = ENV_RANGES.humidity;
    if (wasWarn) {
      return (value < warnLow + hysteresis || value > warnHigh - hysteresis) ? 'warn' : 'ok';
    }
    return (value < warnLow || value > warnHigh) ? 'warn' : 'ok';
  }
  if (type === 'co2') {
    if (value > ENV_RANGES.co2.danger) return 'danger';
    if (value > ENV_RANGES.co2.warn) return 'warn';
    return 'ok';
  }
  if (type === 'voc') {
    if (value < ENV_RANGES.voc.danger) return 'danger';
    if (value < ENV_RANGES.voc.warn) return 'warn';
    return 'ok';
  }
  return null;
}

// Reads whatever an RS485 node has reported for this zone so far — keys
// follow the `<type>-<zoneId>` convention rs485.js writes with. Zones with
// no node yet simply read as "no reading", same as any other unwired
// sensor elsewhere in the app.
//
// `previousStatus` — the caller's own persisted `{ humidity, co2, voc }`
// status from last time (thermostat.js/boiler.js's `rt.envStatus`), so
// humidity's hysteresis (see ENV_RANGES/classifyEnv's own comments) has
// something to compare against. Optional and defaults to {} — callers
// with no persisted state to track (monitorZones.js, which never alerts
// on these at all) just get the plain, un-hystereses 30/50 classification,
// same as before this existed.
function readEnvironment(zoneId, previousStatus = {}) {
  const env = {};
  for (const type of ['humidity', 'pressure', 'voc', 'co2']) {
    const r = sensors.get(`${type}-${zoneId}`);
    const value = typeof r?.value === 'number' ? r.value : null;
    env[type] = {
      value,
      updatedAt: r?.updatedAt ?? null,
      sensorOk: value !== null && !r.stale,
      status: classifyEnv(type, value, previousStatus[type] === 'warn'),
    };
  }
  return env;
}

// Edge-triggered — push once on the transition into (or out of) a non-'ok'
// tier, not every tick while it stays there. `rt.envStatus` is a plain
// object the caller owns and persists across ticks.
function updateEnvironmentAlerts(zoneLabel, rt, env) {
  const LABEL = { humidity: 'Humidity', co2: 'CO2', voc: 'VOC' };
  const UNIT = { humidity: '%', co2: 'ppm', voc: '' };
  for (const type of ['humidity', 'co2', 'voc']) {
    const status = env[type].status;
    if (status === null) continue; // no reading yet — leave last known state alone
    const was = rt.envStatus[type];
    if (status !== was) {
      if (status !== 'ok') {
        sendPush(
          `${zoneLabel} ${LABEL[type]} is ${status === 'danger' ? 'critically ' : ''}out of range: ${env[type].value}${UNIT[type]}`,
          `Thermostat: ${LABEL[type]} Alert`
        );
      } else if (was) {
        sendPush(`${zoneLabel} ${LABEL[type]} is back in a normal range.`, 'Thermostat: Resolved');
      }
    }
    rt.envStatus[type] = status;
  }
}

module.exports = { ENV_RANGES, classifyEnv, readEnvironment, updateEnvironmentAlerts };
