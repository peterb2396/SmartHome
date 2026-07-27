/**
 * GPIO Map
 * ─────────────────────────────────────────────────────────────────
 * A living reference of what's wired to each PHYSICAL PI GPIO PIN — for
 * the Console page's "GPIO Map" panel. This is documentation, not control:
 * editing an entry here relabels the reference, it does NOT change what
 * the actual pin does. To actually move something to a different pin, edit
 * the real config (gpio.js / faultLed.js) and update this map to match.
 *
 * All HVAC relay control (zone dampers, air handler, gas boiler) has moved
 * off direct Pi GPIO entirely and now runs over I2C relay boards — see
 * i2cRelay.js's header comment and the wiring guide for that mapping
 * (board address + channel, not a Pi pin, so it doesn't belong in this
 * pin-specific map). What's left here is genuinely just Pi GPIO: PIR
 * motion sensing and the two fault-status LEDs. The RS485 bus doesn't use
 * a Pi GPIO pin either — it connects via a USB-to-RS485 adapter (see
 * rs485.js), so it has no entry here.
 *
 * Seeded once from every createPin() call that exists in the code today
 * (gpio.js + faultLed.js). After the first read this is fully user-managed
 * (add/edit/remove), same schema-less settings-blob pattern as
 * thermostat.js/maintenance.js (key 'gpioMap').
 */

const settingsSvc = require('./settings');

const GROUPS = {
  'motion':             { label: 'Motion',              color: '#14b8a6' },
  'status-led':         { label: 'Status LED',          color: '#ef4444' },
  'other':              { label: 'Other',                color: '#94a3b8' },
};

// Ground truth as of this file's writing — see gpio.js / faultLed.js for
// the actual pin assignments if this ever needs re-syncing.
const SEED_PINS = [
  { pin: 22, label: 'PIR motion sensor',                direction: 'in',  group: 'motion' },
  { pin: 5,  label: 'Fault LED (red)',                  direction: 'out', group: 'status-led' },
  { pin: 6,  label: 'Fault LED (yellow)',               direction: 'out', group: 'status-led' },
];

function getSettings() {
  const stored = settingsSvc.get()?.gpioMap;
  if (stored) return stored;
  // First read ever — seed from SEED_PINS.
  return Object.fromEntries(SEED_PINS.map(p => [p.pin, { ...p, notes: '' }]));
}

async function saveSettings(next) {
  await settingsSvc.updateSetting('gpioMap', next);
}

function getState() {
  const pins = getSettings();
  return {
    pins: Object.values(pins).sort((a, b) => a.pin - b.pin),
    groups: GROUPS,
  };
}

async function upsertPin({ pin, label, direction, group, notes }) {
  if (typeof pin !== 'number' || Number.isNaN(pin)) throw new Error('pin must be a number');
  if (!label || !label.trim()) throw new Error('label is required');
  if (!['in', 'out'].includes(direction)) throw new Error("direction must be 'in' or 'out'");
  if (!GROUPS[group]) throw new Error(`Unknown group ${group}`);
  const pins = getSettings();
  const next = { ...pins, [pin]: { pin, label: label.trim(), direction, group, notes: notes || '' } };
  await saveSettings(next);
  return next[pin];
}

async function removePin(pin) {
  const pins = getSettings();
  const next = { ...pins };
  delete next[pin];
  await saveSettings(next);
}

module.exports = { getState, upsertPin, removePin, GROUPS };
