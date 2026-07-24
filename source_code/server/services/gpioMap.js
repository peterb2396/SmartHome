/**
 * GPIO Map
 * ─────────────────────────────────────────────────────────────────
 * A living reference of what's wired to each pin on the Pi — for the
 * Console page's "GPIO Map" panel. This is documentation, not control:
 * editing an entry here relabels the reference, it does NOT change what
 * the actual pin does. To actually move a relay/sensor to a different
 * pin, edit the real config (gpio.js, thermostat.js's ZONES/PLANT_RELAYS)
 * and update this map to match.
 *
 * Just the Pi — no other board in the picture. The RS485 bus doesn't use a
 * Pi GPIO pin either — it connects via a USB-to-RS485 adapter (see
 * rs485.js), so it has no entry here.
 *
 * Seeded once from every createPin() call that exists in the code today
 * (gpio.js + thermostat.js + faultLed.js) — all 4 zones' dampers included,
 * 2 relays each (open/close, see thermostat.js's driveDamper()). After the
 * first read this is fully user-managed (add/edit/remove), same
 * schema-less settings-blob pattern as thermostat.js/maintenance.js (key
 * 'gpioMap').
 */

const settingsSvc = require('./settings');

const GROUPS = {
  'zone-dampers':       { label: 'Zone Dampers',        color: '#8b5cf6' },
  'heat-source-relays': { label: 'Heat Source Relays',  color: '#f59e0b' },
  'motion':             { label: 'Motion',              color: '#14b8a6' },
  'status-led':         { label: 'Status LED',          color: '#ef4444' },
  'other':              { label: 'Other',                color: '#94a3b8' },
};

// Ground truth as of this file's writing — see gpio.js / thermostat.js /
// faultLed.js for the actual pin assignments if this ever needs re-syncing.
const SEED_PINS = [
  { pin: 4,  label: 'Primary Suite damper OPEN relay',  direction: 'out', group: 'zone-dampers' },
  { pin: 12, label: 'Primary Suite damper CLOSE relay', direction: 'out', group: 'zone-dampers' },
  { pin: 13, label: 'Upstairs damper OPEN relay',       direction: 'out', group: 'zone-dampers' },
  { pin: 16, label: 'Upstairs damper CLOSE relay',      direction: 'out', group: 'zone-dampers' },
  { pin: 17, label: 'Office damper OPEN relay',         direction: 'out', group: 'zone-dampers' },
  { pin: 18, label: 'Office damper CLOSE relay',        direction: 'out', group: 'zone-dampers' },
  { pin: 27, label: 'Downstairs damper OPEN relay',     direction: 'out', group: 'zone-dampers' },
  { pin: 23, label: 'Downstairs damper CLOSE relay',    direction: 'out', group: 'zone-dampers' },
  { pin: 19, label: 'Cool-mode / reversing valve',      direction: 'out', group: 'heat-source-relays' },
  { pin: 20, label: 'Gas heat call relay',              direction: 'out', group: 'heat-source-relays' },
  { pin: 21, label: 'Electric heat call relay',         direction: 'out', group: 'heat-source-relays' },
  { pin: 26, label: 'Air (heat pump) call relay',       direction: 'out', group: 'heat-source-relays' },
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
