/**
 * Monitor Zones
 * ─────────────────────────────────────────────────────────────────
 * Read-only zones shown on the Console and (optionally, behind a toggle)
 * the Thermostat page — basement and attic, which get a full BME680+SCD41
 * RS485 node but have no damper actuator, so they're never part of
 * thermostat.js's ZONES/relay logic.
 *
 * `tempSensor` is the sensorStore key for temperature (own convention,
 * matching thermostat.js's ZONES) — humidity/pressure/voc/co2 instead reuse
 * envSensors.js's readEnvironment(), the same humidity/pressure/voc/co2
 * read+classify logic thermostat.js/boiler.js's real zones already use, so
 * the status thresholds (and the sensorStore key convention they read from,
 * `<type>-<zoneId>`) only exist in one place. Add a new entry here for each
 * new monitor-only zone — everything renders as "no reading" until an
 * RS485 node reports under that zone id, exactly like any other
 * not-yet-wired sensor today.
 */

const sensors = require('./sensorStore');
const { readEnvironment } = require('./envSensors');

const MONITOR_ZONES = [
  { id: 'basement', label: 'Basement', tempSensor: 'temp-basement' },
  { id: 'attic',    label: 'Attic',    tempSensor: 'temp-attic' },
];

function reading(name) {
  const r = sensors.get(name);
  if (!r || typeof r.value !== 'number') return { value: null, updatedAt: null, sensorOk: false };
  return { value: r.value, updatedAt: r.updatedAt, sensorOk: !r.stale };
}

function getState() {
  return MONITOR_ZONES.map(zone => ({
    id: zone.id,
    label: zone.label,
    temperature: reading(zone.tempSensor),
    environment: readEnvironment(zone.id),
  }));
}

module.exports = { getState, MONITOR_ZONES };
