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

async function configureNode(uniqueId, { name, kind, zoneId, sensors }) {
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
    kind: kind || 'other',
    zoneId: zoneId || null,
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
