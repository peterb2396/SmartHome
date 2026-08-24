/**
 * Node Registry
 * ─────────────────────────────────────────────────────────────────
 * Tracks configured RS485 sensor nodes for the Console's "New Nodes" setup
 * panel. Storage follows the same schema-less settings-blob pattern as
 * thermostat.js/maintenance.js (key 'nodes').
 *
 * `pending` (nodes that exist on the bus but haven't been named/configured
 * yet) comes live from rs485.js's ANNOUNCE tracking — this module just
 * filters out anything already configured, so a node doesn't show up in
 * both lists after setup.
 */

const settingsSvc = require('./settings');
const rs485 = require('./rs485');

function getSettings() {
  const stored = settingsSvc.get()?.nodes;
  return stored || {};
}

async function saveSettings(next) {
  await settingsSvc.updateSetting('nodes', next);
}

function getState() {
  const nodes = getSettings();
  const configured = Object.values(nodes).sort((a, b) => a.name.localeCompare(b.name));
  const configuredIds = new Set(configured.map(n => n.uniqueId));
  return {
    configured,
    pending: rs485.getPending().filter(n => !configuredIds.has(n.uniqueId)),
  };
}

async function configureNode(uniqueId, { name, kind, zoneId, soundZoneId, hasDial, sensors }) {
  if (!uniqueId) throw new Error('uniqueId is required');
  if (!name || !name.trim()) throw new Error('name is required');
  const nodes = getSettings();
  const existing = nodes[uniqueId];
  // A brand-new node (coming from "pending") needs a bus address assigned
  // before it can be polled — an existing node being renamed/re-zoned
  // keeps whatever address it already has.
  const busAddress = existing?.busAddress ?? rs485.assignAddress(uniqueId, Object.values(nodes).map(n => n.busAddress).filter(Boolean));
  const node = {
    uniqueId,
    name: name.trim(),
    // `kind` is this node's OWN sensor role — 'thermostat' (SCD41 only —
    // no BME680 on these; CO2 is the only real reading a wired-up HVAC
    // zone will ever report), 'monitor' (BME680 + SCD41, basement/attic
    // only — the full sensor set lives there, not on the thermostat
    // zones), or 'other' (no sensors). `zoneAudio` is a
    // separate, unrelated node type. `hasDial` is orthogonal to `kind` —
    // a physical RP2040 board bridges to an attached ESP32 dial over I2C
    // and answers BOTH POLL/REPORT (its own sensors, if any) and
    // POLL_DIAL/DIAL_STATE (the dial) on the SAME bus address, per the
    // "one mass-produced RP2040 board per thermostat, dial as an I2C
    // accessory just like the sensors" design — see rs485.js's header.
    // A dial with no sensors of its own (no thermostat zone nearby) is
    // just kind='other' + hasDial=true, no separate "dial" kind needed.
    kind: kind || 'other',
    // `zoneId` is a thermostat zone; `soundZoneId` is a sound zone —
    // separate id spaces (see sound.js's header comment for why). Only
    // relevant when hasDial is true; a `zoneAudio` node only ever uses
    // `zoneId`, reused there to mean its (sound) zone rather than adding
    // a third field for what's otherwise a single-purpose node.
    zoneId: zoneId || null,
    soundZoneId: soundZoneId || null,
    hasDial: !!hasDial,
    sensors: Array.isArray(sensors) ? sensors : [],
    busAddress,
    configuredAt: existing?.configuredAt || new Date().toISOString(),
  };
  await saveSettings({ ...nodes, [uniqueId]: node });
  return node;
}

async function removeNode(uniqueId) {
  const nodes = getSettings();
  const next = { ...nodes };
  delete next[uniqueId];
  await saveSettings(next);
}

module.exports = { getState, configureNode, removeNode };
