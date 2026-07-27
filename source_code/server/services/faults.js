/**
 * Faults
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for "is something wrong right now" — shared by
 * the Console page's fault banner (GET /console/faults) and the physical
 * fault LED (faultLed.js), so both are reading the same list instead of
 * the frontend re-deriving its own copy of this logic.
 */

const thermostatSvc = require('./thermostat');
const sensors = require('./sensorStore');
const gpioSvc = require('./gpio');

function getFaults() {
  const faults = [];
  const { zones } = thermostatSvc.getState();

  // Air handler's own ALARM dry contact (CN33), read directly onto GPIO 26
  // — see gpio.js's setupHvacFault(). A single latched flag, not per-zone,
  // since the AHU doesn't tell us which zone (if any) it relates to.
  if (gpioSvc.isHvacFaultActive()) {
    faults.push({ id: 'hvac-fault', message: 'Air handler is reporting an active fault (ALARM signal)' });
  }

  for (const z of zones) {
    if (z.safety === 'below-min') {
      faults.push({ id: `safety-${z.id}`, message: `Freeze protection active in ${z.label}` });
    } else if (z.safety === 'above-max') {
      faults.push({ id: `safety-${z.id}`, message: `Safety cooling active in ${z.label}` });
    }
    if (!z.sensorOk) {
      faults.push({ id: `stale-${z.id}`, message: `Not reporting: ${z.label}` });
    }
  }

  // Forward-compatible: no leak hardware exists yet, so this simply never
  // fires until an RS485 node reports a `leak-*` sensor as "wet".
  for (const [name, data] of Object.entries(sensors.getAll())) {
    if (name.startsWith('leak-') && typeof data.value === 'string' && data.value.toLowerCase() === 'wet') {
      faults.push({ id: `leak-${name}`, message: `Water leak detected: ${name.replace('leak-', '').replace(/-/g, ' ')}` });
    }
  }

  return faults;
}

module.exports = { getFaults };
