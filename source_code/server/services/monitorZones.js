/**
 * Monitor Zones
 * ─────────────────────────────────────────────────────────────────
 * Read-only zones shown on the Console but not the Thermostat page —
 * basement and attic, which get temp/humidity sensors but have no damper
 * actuator, so they're never part of thermostat.js's ZONES/relay logic.
 *
 * Add a new entry here for each new monitor-only zone. `tempSensor`/
 * `humiditySensor` are sensorStore keys — same convention as thermostat.js's
 * ZONES, and they'll render as "no reading" until an RS485 node reports
 * under those names, exactly like any other not-yet-wired sensor today.
 */

const sensors = require('./sensorStore');

const MONITOR_ZONES = [
  { id: 'basement', label: 'Basement', tempSensor: 'temp-basement', humiditySensor: 'humidity-basement' },
  { id: 'attic',    label: 'Attic',    tempSensor: 'temp-attic',    humiditySensor: 'humidity-attic' },
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
    humidity: reading(zone.humiditySensor),
  }));
}

module.exports = { getState, MONITOR_ZONES };
