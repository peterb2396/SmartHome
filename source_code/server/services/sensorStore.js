/**
 * Sensor Store
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for ALL sensor readings, regardless of
 * where they came from (Pi GPIO, RS485 node poll, etc.)
 *
 * Both gpio.js and smarthome.js import this — they share the same object.
 *
 * Freshness: every sensor (temp, humidity, whatever) is expected to report
 * at least once a minute — rs485.js polls each configured node on that
 * cadence. STALE_MS gives a few missed cycles of grace before a reading is
 * flagged stale, so routine jitter doesn't false-positive. Anything
 * consuming sensor data —
 * the general /sensors views AND the thermostat's safety-range check —
 * reads through get()/getAll() and gets the same `stale` flag for free.
 */

const STALE_MS = 3 * 60 * 1000; // 3 minutes — a few missed 60s cycles' grace

// { [name]: { value, unit, metadata, updatedAt } }
const store = {};

function withStaleness(reading) {
  if (!reading) return reading;
  return { ...reading, stale: (Date.now() - new Date(reading.updatedAt).getTime()) > STALE_MS };
}

/**
 * Write a sensor reading.
 * @param {string} name       e.g. "temp-attic", "humidity-office"
 * @param {*}      value      e.g. "open", 72.4, true
 * @param {string} [unit]     e.g. "F", "%"
 * @param {Object} [metadata] any extra info e.g. { location: "attic" }
 */
function set(name, value, unit = null, metadata = {}) {
  store[name] = {
    value,
    unit,
    metadata,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Read one sensor. Includes a computed `stale` flag (see STALE_MS above).
 * @param {string} name
 * @returns {{ value, unit, metadata, updatedAt, stale } | null}
 */
function get(name) {
  return withStaleness(store[name]) ?? null;
}

/**
 * Read all sensors, optionally filtered by name prefix. Each reading
 * includes a computed `stale` flag.
 * @param {string} [prefix]  e.g. "temp" returns all temp-* sensors
 */
function getAll(prefix = '') {
  const entries = prefix
    ? Object.entries(store).filter(([k]) => k.startsWith(prefix))
    : Object.entries(store);
  return Object.fromEntries(entries.map(([k, v]) => [k, withStaleness(v)]));
}

/**
 * Whether a sensor is missing entirely or hasn't reported recently.
 * @param {string} name
 */
function isStale(name) {
  const reading = store[name];
  if (!reading) return true;
  return (Date.now() - new Date(reading.updatedAt).getTime()) > STALE_MS;
}

module.exports = { set, get, getAll, isStale, STALE_MS };
