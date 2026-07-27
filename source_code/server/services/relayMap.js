/**
 * Relay Map
 * ─────────────────────────────────────────────────────────────────
 * A living reference of what's wired to each I2C relay board channel — for
 * the Console page's "Relay Map" panel. This is documentation, not control:
 * editing an entry here relabels the reference, it does NOT change what the
 * actual channel does. To actually move something to a different channel,
 * edit the real config (thermostat.js / boiler.js) and update this map to
 * match.
 *
 * Keyed by "<address>:<channel>" (e.g. "32:6" for board 0x20 channel 6)
 * since channel numbers 0-7 repeat across boards — see i2cRelay.js for the
 * board/channel addressing scheme itself.
 *
 * Seeded once from every setChannel() call that exists in the code today
 * (thermostat.js + boiler.js). After the first read this is fully
 * user-managed (add/edit/remove), same schema-less settings-blob pattern as
 * gpioMap.js (key 'relayMap').
 */

const settingsSvc = require('./settings');

const BOARDS = {
  '32': { label: 'Damper Board (0x20)',      color: '#3b82f6' },
  '33': { label: 'Air Handler Board (0x21)', color: '#f59e0b' },
  '34': { label: 'Boiler Board (0x22)',      color: '#ef4444' },
};

// Ground truth as of this file's writing — see thermostat.js / boiler.js
// for the actual channel assignments if this ever needs re-syncing.
const SEED_RELAYS = [
  // Damper board (0x20) — one open/close relay pair per zone.
  { address: 0x20, channel: 0, label: 'Primary Suite damper — open' },
  { address: 0x20, channel: 1, label: 'Primary Suite damper — close' },
  { address: 0x20, channel: 2, label: 'Upstairs damper — open' },
  { address: 0x20, channel: 3, label: 'Upstairs damper — close' },
  { address: 0x20, channel: 4, label: 'Downstairs damper — open' },
  { address: 0x20, channel: 5, label: 'Downstairs damper — close' },
  { address: 0x20, channel: 6, label: 'Office damper — open' },
  { address: 0x20, channel: 7, label: 'Office damper — close' },
  // Air handler board (0x21) — CH1/R is jumpered (not switched), C not run.
  { address: 0x21, channel: 1, label: 'B — heating reversing valve' },
  { address: 0x21, channel: 2, label: 'Y1 — compressor stage 1' },
  { address: 0x21, channel: 3, label: 'G — indoor fan' },
  { address: 0x21, channel: 4, label: 'Y2 — compressor stage 2' },
  { address: 0x21, channel: 5, label: 'W1 — electric heat stage 1' },
  { address: 0x21, channel: 6, label: 'W2 — electric heat stage 2' },
  // Boiler board (0x22) — only 3 relays wired; CH4 (channel 3) is free for
  // a future use, not code-driven — see the wiring guide.
  { address: 0x22, channel: 5, label: 'Upstairs zone valve' },
  { address: 0x22, channel: 6, label: 'Great Room zone valve' },
  { address: 0x22, channel: 7, label: 'Downstairs zone valve' },
];

function keyFor(address, channel) {
  return `${address}:${channel}`;
}

function getSettings() {
  const stored = settingsSvc.get()?.relayMap;
  if (stored) return stored;
  // First read ever — seed from SEED_RELAYS.
  return Object.fromEntries(SEED_RELAYS.map(r => [keyFor(r.address, r.channel), { ...r, notes: '' }]));
}

async function saveSettings(next) {
  await settingsSvc.updateSetting('relayMap', next);
}

function getState() {
  const relays = getSettings();
  return {
    relays: Object.values(relays).sort((a, b) => a.address - b.address || a.channel - b.channel),
    boards: BOARDS,
  };
}

async function upsertRelay({ address, channel, label, notes }) {
  if (typeof address !== 'number' || Number.isNaN(address)) throw new Error('address must be a number');
  if (typeof channel !== 'number' || channel < 0 || channel > 7) throw new Error('channel must be 0-7');
  if (!label || !label.trim()) throw new Error('label is required');
  const relays = getSettings();
  const key = keyFor(address, channel);
  const next = { ...relays, [key]: { address, channel, label: label.trim(), notes: notes || '' } };
  await saveSettings(next);
  return next[key];
}

async function removeRelay(address, channel) {
  const relays = getSettings();
  const next = { ...relays };
  delete next[keyFor(address, channel)];
  await saveSettings(next);
}

module.exports = { getState, upsertRelay, removeRelay, BOARDS };
