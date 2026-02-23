/**
 * Sensor Store
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for ALL sensor readings, regardless of
 * where they came from (Pi GPIO, ESP32 WiFi report, etc.)
 *
 * Both gpio.js and smarthome.js import this — they share the same object.
 */

// { [name]: { value, unit, metadata, updatedAt } }
const store = {};

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
 * Read one sensor.
 * @param {string} name
 * @returns {{ value, unit, metadata, updatedAt } | null}
 */
function get(name) {
  return store[name] ?? null;
}

/**
 * Read all sensors, optionally filtered by name prefix.
 * @param {string} [prefix]  e.g. "window" returns all window-* sensors
 */
function getAll(prefix = '') {
  if (!prefix) return { ...store };
  return Object.fromEntries(
    Object.entries(store).filter(([k]) => k.startsWith(prefix))
  );
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

module.exports = { set, get, getAll, setBulk };
