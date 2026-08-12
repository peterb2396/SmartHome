/**
 * Lutron Caseta Service
 * ─────────────────────────────────────────────────────────────────
 * Replaces the SmartThings-mediated path for lights/fans entirely — all
 * switches are Lutron Caseta, controlled directly over the local network
 * via the Smart Bridge PRO's legacy Telnet Integration Protocol (port 23).
 * Appliances and smart plugs are untouched and still go through
 * smartthings.js/lights.js — this file only concerns Lutron devices.
 *
 * Unlike the original one-shot implementation this replaces (connect,
 * login, send one command, disconnect — ~1.5s per call, no status), this
 * keeps ONE persistent connection open. Two reasons:
 *   1. Commands are near-instant instead of paying a fresh connect+login
 *      penalty every time.
 *   2. The bridge broadcasts `~OUTPUT,<id>,1,<level>` to every open Telnet
 *      session whenever ANY output changes — including a physical
 *      wall-switch press, not just our own commands — so keeping the
 *      connection open gives live dimming/fan-speed status for free,
 *      no polling needed.
 *
 * Auto-reconnects on drop (same pattern as rs485.js's handleDisconnect()/
 * scheduleReconnect(), for the same reason: a local network hiccup
 * shouldn't need a server restart to recover from) and feeds isBridgeDown()
 * into faults.js exactly like rs485.js's isBusDown() does.
 *
 * Device registry (which Integration IDs exist, their name/type/room) is
 * schema-less settings-blob (key 'lutronDevices'), same pattern as every
 * other registry in this app (nodeRegistry.js, gpioMap.js, relayMap.js) —
 * but genuinely starts empty rather than seeded, since Lutron doesn't
 * self-announce devices the way RS485 nodes do. Devices are added manually
 * (Integration ID from the Lutron app's "Send Integration Report" email)
 * via the Lights page.
 */

const net = require('net');
const settingsSvc = require('./settings');
const { sendPush } = require('./mail');

const BRIDGE_IP = process.env.LUTRON_BRIDGE_IP || '192.168.4.135';
const BRIDGE_PORT = Number(process.env.LUTRON_BRIDGE_PORT) || 23; // real bridges always use 23; overridable for testing
const LOGIN_USER = 'lutron';
const LOGIN_PASS = 'integration';
const RECONNECT_INTERVAL_MS = 10000;
const DEVICE_TYPES = ['dimmer', 'switch', 'fan'];

let socket = null;
let ready = false; // connected AND logged in AND initial state query done
let reconnectTimer = null;
let rxBuffer = '';
let bridgeDown = false;
const deviceState = new Map(); // integrationId (number) -> { on, level }

// ── Device registry ─────────────────────────────────────────────────────
function getDevices() {
  return settingsSvc.get()?.lutronDevices || {};
}

async function saveDevices(next) {
  await settingsSvc.updateSetting('lutronDevices', next);
}

async function upsertDevice({ integrationId, name, type, room, owner }) {
  if (integrationId == null || Number.isNaN(Number(integrationId))) throw new Error('integrationId must be a number');
  if (!name || !name.trim()) throw new Error('name is required');
  if (!DEVICE_TYPES.includes(type)) throw new Error(`type must be one of ${DEVICE_TYPES.join(', ')}`);
  const id = Number(integrationId);
  const devices = getDevices();
  const next = {
    ...devices,
    [id]: { integrationId: id, name: name.trim(), type, room: room?.trim() || 'Uncategorized', owner: owner || '' },
  };
  await saveDevices(next);
  if (ready) queryState(id); // seed state immediately rather than waiting for it to change
  return next[id];
}

async function removeDevice(integrationId) {
  const devices = getDevices();
  const next = { ...devices };
  delete next[Number(integrationId)];
  await saveDevices(next);
  deviceState.delete(Number(integrationId));
}

// ── Fault tracking — same edge-triggered pattern as rs485.js's setBusDown() ─
function setBridgeDown(down) {
  if (down === bridgeDown) return;
  bridgeDown = down;
  if (down) {
    console.warn('[Lutron] Bridge is unreachable.');
    sendPush('The Lutron bridge is unreachable — lights/fans cannot be controlled until this recovers.', 'Lutron: Bridge Down');
  } else {
    console.log('[Lutron] Bridge back online.');
    sendPush('The Lutron bridge is back online.', 'Lutron: Resolved');
  }
}

function isBridgeDown() {
  return bridgeDown;
}

// ── Connection ───────────────────────────────────────────────────────────
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_INTERVAL_MS);
}

function handleDisconnect() {
  ready = false;
  socket = null;
  setBridgeDown(true);
  scheduleReconnect();
}

function connect() {
  const s = new net.Socket();
  s.setTimeout(15000);
  s.on('timeout', () => s.destroy(new Error('connection timed out')));
  s.on('error', (err) => console.warn(`[Lutron] Connection error: ${err.message}`));
  s.on('close', handleDisconnect);

  s.connect(BRIDGE_PORT, BRIDGE_IP, () => {
    console.log(`[Lutron] Connected to bridge at ${BRIDGE_IP}:${BRIDGE_PORT}, logging in…`);
    // Fixed-delay login, same timing as the original implementation this
    // replaces (no reliable prompt string to wait on instead) — after
    // this, the connection stays open and switches to steady-state mode.
    s.write(`${LOGIN_USER}\r\n`);
    setTimeout(() => s.write(`${LOGIN_PASS}\r\n`), 500);
    setTimeout(() => {
      socket = s;
      ready = true;
      setBridgeDown(false);
      console.log('[Lutron] Logged in — bridge ready.');
      // Seed current state for every registered device — we won't hear a
      // ~OUTPUT push until something actually changes.
      for (const id of Object.keys(getDevices())) queryState(Number(id));
    }, 1500);
  });

  s.on('data', (chunk) => {
    rxBuffer += chunk.toString();
    let idx;
    while ((idx = rxBuffer.indexOf('\n')) !== -1) {
      const line = rxBuffer.slice(0, idx).trim();
      rxBuffer = rxBuffer.slice(idx + 1);
      if (line) handleLine(line);
    }
  });
}

// Matches ~OUTPUT,<id>,1,<level> — the bridge's async state broadcast, sent
// for our own commands AND for physical wall-switch presses AND for
// changes made from the Lutron app itself, unprompted.
const OUTPUT_LINE_RE = /^~OUTPUT,(\d+),1,([\d.]+)/;

function handleLine(line) {
  const match = OUTPUT_LINE_RE.exec(line);
  if (!match) return; // login prompts / echoes / anything else — not state data
  const id = Number(match[1]);
  const level = Number(match[2]);
  deviceState.set(id, { on: level > 0, level });
}

function queryState(integrationId) {
  if (!ready || !socket) return;
  socket.write(`?OUTPUT,${integrationId},1\r\n`);
}

// ── Control ──────────────────────────────────────────────────────────────
// level: 0-100. For 'switch' type devices the frontend only ever sends
// 0/100; for 'dimmer'/'fan' the bridge accepts the same 0-100 range and
// (for fan speed controllers) snaps to its nearest supported discrete
// speed on its own — same assumption the original implementation already
// relied on successfully.
async function setDevice(integrationId, { on, level }) {
  const devices = getDevices();
  const device = devices[integrationId];
  if (!device) throw new Error(`Unknown Lutron device ${integrationId}`);
  if (!ready || !socket) throw new Error('Lutron bridge is not connected');

  const targetLevel = on ? (level ?? 100) : 0;
  socket.write(`#OUTPUT,${integrationId},1,${targetLevel}\r\n`);
  // Optimistic local update — the bridge's own ~OUTPUT echo will confirm
  // (or correct) this shortly after, same as how rs485.js's dial handling
  // trusts pushed state over a locally-guessed one.
  deviceState.set(Number(integrationId), { on: targetLevel > 0, level: targetLevel });
  return getState();
}

function getState() {
  const devices = getDevices();
  return {
    bridgeConnected: ready,
    devices: Object.values(devices)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(d => ({ ...d, ...(deviceState.get(d.integrationId) ?? { on: false, level: 0 }) })),
  };
}

async function init() {
  connect();
  console.log('[Lutron] Service initialized.');
}

module.exports = { init, getState, setDevice, upsertDevice, removeDevice, isBridgeDown, DEVICE_TYPES };
