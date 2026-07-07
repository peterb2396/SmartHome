/**
 * Sensor Store
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for ALL sensor readings, regardless of
 * where they came from (Pi GPIO, ESP32 WiFi report, etc.)
 *
 * Both gpio.js and smarthome.js import this — they share the same object.
 *
 * Freshness: every sensor (window, temp, whatever) is expected to report
 * at least once a minute — the attic ESP32 batches a report every 60s
 * (attic_node.ino), and gpio.js re-confirms every Pi-wired reed switch on
 * the same 60s cadence on top of its interrupt-driven watch(). STALE_MS
 * gives a few missed cycles of grace before a reading is flagged stale, so
 * routine jitter doesn't false-positive. Anything consuming sensor data —
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
 * @param {string} name       e.g. "garage", "temp-attic", "window-north"
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
 * @param {string} [prefix]  e.g. "window" returns all window-* sensors
 */
function getAll(prefix = '') {
  const entries = prefix
    ? Object.entries(store).filter(([k]) => k.startsWith(prefix))
    : Object.entries(store);
  return Object.fromEntries(entries.map(([k, v]) => [k, withStaleness(v)]));
}

/**
 * Bulk-write multiple sensors at once (used by ESP32 batch report).
 * @param {Object} sensors  { name: { value, unit?, metadata? }, ... }
 */
function setBulk(sensors) {
  const now = new Date().toISOString();
  for (const [name, reading] of Object.entries(sensors)) {
    store[name] = {
      value:     reading.value,
      unit:      reading.unit     ?? null,
      metadata:  reading.metadata ?? {},
      updatedAt: now,
    };
  }
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

module.exports = { set, get, getAll, setBulk, isStale, STALE_MS };
