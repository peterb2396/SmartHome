/**
 * RS485 Bus Service
 * ─────────────────────────────────────────────────────────────────
 * Master side of the RS485 sensor bus: every zone has an RP2040 node
 * (TTL-to-RS485 converter + LM2596 24V→5V step-down; thermostat-zone nodes
 * additionally carry a BME680 + SCD41) reporting its temperature over a
 * half-duplex serial link. The Pi's end of the bus is a USB-to-RS485
 * adapter (RS485_PORT_PATH below) — the adapter handles direction
 * switching internally, so no GPIO pins are needed on the Pi side for the
 * bus itself. This module owns the wire protocol, polls configured nodes
 * for readings, writes them into sensorStore as `<type>-<zoneId>` (e.g.
 * `temp-office`), and tracks any node that's announced itself on the bus
 * but hasn't been named yet — that's what feeds the Console's "New Nodes"
 * panel.
 *
 * Decision logic (thermostat control, safety ranges, cost selection) stays
 * on the server — these nodes are pure sensor input. Damper actuation is
 * separate, direct-wired Pi relays (see thermostat.js's driveDamper()),
 * not commanded over this bus. SET_RELAY exists in the protocol for a
 * possible future actuator-carrying node type, but nothing configured
 * today uses it.
 *
 * ── Wire protocol ────────────────────────────────────────────────────────
 * Frame: [0xAA sync][addr 1B][cmd 1B][len 1B][payload...][crc8 1B]
 * addr 0x00 is reserved for broadcast / not-yet-configured nodes.
 *
 * Master → node:
 *   0x01 POLL       — request a report. Payload: none.
 *   0x02 ASSIGN      — broadcast only. Payload: [uniqueId 8B][newAddr 1B].
 *                      Only the node whose uniqueId matches adopts newAddr
 *                      and persists it to flash.
 *   0x03 SET_RELAY   — Payload: [relayIndex 1B][state 1B]. Unused today.
 *
 * Node → master:
 *   0x81 ANNOUNCE    — sent on addr 0x00 while unconfigured, every few
 *                      seconds. Payload: [uniqueId 8B][capabilities 1B].
 *   0x82 REPORT      — reply to POLL. Payload: repeated
 *                      [sensorType 1B][value float32 4B] tuples.
 *   0x83 ACK         — generic acknowledgement for ASSIGN/SET_RELAY.
 *
 * Sensor type byte (REPORT payload):
 *   0x01 temperature (°F)   0x02 humidity (%RH)   0x03 pressure (hPa)
 *   0x04 voc (0-100 heuristic score)              0x05 co2 (ppm)
 */

const sensors = require('./sensorStore');

const SYNC = 0xaa;
const CMD = { POLL: 0x01, ASSIGN: 0x02, SET_RELAY: 0x03, ANNOUNCE: 0x81, REPORT: 0x82, ACK: 0x83 };
const SENSOR_TYPE = { temperature: 0x01, humidity: 0x02, pressure: 0x03, voc: 0x04, co2: 0x05 };
const SENSOR_TYPE_NAME = Object.fromEntries(Object.entries(SENSOR_TYPE).map(([k, v]) => [v, k]));
const SENSOR_UNIT = { temperature: 'F', humidity: '%', pressure: 'hPa', voc: 'score', co2: 'ppm' };
// sensorStore key prefix per type — 'temperature' on the wire but 'temp' in
// the store, matching thermostat.js's `tempSensor: 'temp-<zoneId>'`
// convention. Every other type's wire name IS its prefix.
const SENSOR_KEY_PREFIX = { temperature: 'temp', humidity: 'humidity', pressure: 'pressure', voc: 'voc', co2: 'co2' };

const RS485_PORT_PATH = process.env.RS485_PORT || '/dev/ttyUSB0'; // USB-to-RS485 adapter
const BAUD_RATE = 9600;
const POLL_INTERVAL_MS = 10000;
const ANNOUNCE_STALE_MS = 30000; // drop a pending node from the list if it stops announcing

const ANNOUNCE_TIMEOUT_MS = 300; // how long to wait for a REPORT after POLL before giving up

let port = null;
let usingMock = true;
const pendingNodes = new Map(); // uniqueId -> { uniqueId, lastSeenAt }
let rxBuffer = Buffer.alloc(0);
let pendingReportResolvers = new Map(); // address -> resolve fn, for the current in-flight POLL

// ── CRC8 (poly 0x07, matches common Arduino Crc8 implementations) ──────────
function crc8(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function buildFrame(addr, cmd, payload = Buffer.alloc(0)) {
  const head = Buffer.from([addr, cmd, payload.length]);
  const body = Buffer.concat([head, payload]);
  return Buffer.concat([Buffer.from([SYNC]), body, Buffer.from([crc8(body)])]);
}

// ── Transport: real serial port, or a silent mock off the Pi ───────────────
function openTransport() {
  let SerialPort;
  try {
    ({ SerialPort } = require('serialport'));
  } catch {
    console.warn('[RS485] serialport package unavailable — using mock transport.');
    return;
  }
  const candidate = new SerialPort({ path: RS485_PORT_PATH, baudRate: BAUD_RATE, autoOpen: false });
  candidate.open((err) => {
    if (err) {
      console.warn(`[RS485] Couldn't open ${RS485_PORT_PATH} (${err.message}) — using mock transport. This is expected off the Pi.`);
      return;
    }
    port = candidate;
    usingMock = false;
    port.on('data', onData);
    port.on('error', (e) => console.error('[RS485] Serial error:', e.message));
    console.log(`[RS485] Bus online on ${RS485_PORT_PATH} at ${BAUD_RATE} baud.`);
  });
}

function writeFrame(frame) {
  if (usingMock || !port) {
    console.log(`[RS485 Mock] would write ${frame.length}B frame: ${frame.toString('hex')}`);
    return;
  }
  port.write(frame);
}

// ── Frame parsing ────────────────────────────────────────────────────────
function onData(chunk) {
  rxBuffer = Buffer.concat([rxBuffer, chunk]);
  let syncIdx;
  while ((syncIdx = rxBuffer.indexOf(SYNC)) !== -1) {
    if (rxBuffer.length < syncIdx + 4) return; // not enough for header yet
    const addr = rxBuffer[syncIdx + 1];
    const cmd = rxBuffer[syncIdx + 2];
    const len = rxBuffer[syncIdx + 3];
    const frameEnd = syncIdx + 4 + len + 1;
    if (rxBuffer.length < frameEnd) return; // wait for the rest

    const payload = rxBuffer.subarray(syncIdx + 4, syncIdx + 4 + len);
    const receivedCrc = rxBuffer[frameEnd - 1];
    const expectedCrc = crc8(rxBuffer.subarray(syncIdx + 1, syncIdx + 4 + len));
    rxBuffer = rxBuffer.subarray(frameEnd);

    if (receivedCrc !== expectedCrc) {
      console.warn('[RS485] CRC mismatch, dropping frame.');
      continue;
    }
    handleFrame(addr, cmd, payload);
  }
}

function handleFrame(addr, cmd, payload) {
  if (cmd === CMD.ANNOUNCE && addr === 0x00) {
    const uniqueId = payload.subarray(0, 8).toString('hex');
    pendingNodes.set(uniqueId, { uniqueId, lastSeenAt: Date.now() });
    return;
  }
  if (cmd === CMD.REPORT) {
    const readings = [];
    for (let i = 0; i + 5 <= payload.length; i += 5) {
      const typeByte = payload[i];
      const value = payload.readFloatLE(i + 1);
      const typeName = SENSOR_TYPE_NAME[typeByte];
      if (typeName) readings.push({ type: typeName, value });
    }
    const resolve = pendingReportResolvers.get(addr);
    if (resolve) { resolve(readings); pendingReportResolvers.delete(addr); }
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────
function pollNode(address, zoneId) {
  return new Promise((resolve) => {
    if (usingMock) return resolve([]); // nothing to poll without real hardware
    const timeout = setTimeout(() => { pendingReportResolvers.delete(address); resolve([]); }, ANNOUNCE_TIMEOUT_MS);
    pendingReportResolvers.set(address, (readings) => { clearTimeout(timeout); resolve(readings); });
    writeFrame(buildFrame(address, CMD.POLL));
  });
}

async function pollAll(configuredNodes) {
  for (const node of configuredNodes) {
    if (node.busAddress == null || !node.zoneId) continue;
    const readings = await pollNode(node.busAddress, node.zoneId);
    for (const { type, value } of readings) {
      sensors.set(`${SENSOR_KEY_PREFIX[type]}-${node.zoneId}`, value, SENSOR_UNIT[type], { source: 'rs485', nodeId: node.uniqueId });
    }
  }
  // Pending nodes go stale (drop off the list) if they stop announcing —
  // e.g. unplugged before ever being configured.
  const now = Date.now();
  for (const [id, n] of pendingNodes) {
    if (now - n.lastSeenAt > ANNOUNCE_STALE_MS) pendingNodes.delete(id);
  }
}

// ── Public API ───────────────────────────────────────────────────────────
function getPending() {
  return Array.from(pendingNodes.values()).map(n => ({ uniqueId: n.uniqueId }));
}

// Assigns the next free bus address (1-250) and tells the node to adopt it.
// Called once, when a pending node is named/configured via the Console.
function assignAddress(uniqueId, usedAddresses) {
  let addr = 1;
  const used = new Set(usedAddresses);
  while (used.has(addr) && addr < 250) addr++;
  const idBytes = Buffer.from(uniqueId, 'hex');
  const payload = Buffer.concat([idBytes, Buffer.from([addr])]);
  writeFrame(buildFrame(0x00, CMD.ASSIGN, payload));
  pendingNodes.delete(uniqueId);
  return addr;
}

let pollTimer = null;
function init(getConfiguredNodes) {
  openTransport();
  pollTimer = setInterval(() => pollAll(getConfiguredNodes()), POLL_INTERVAL_MS);
  console.log('[RS485] Service initialized.');
}

module.exports = { init, getPending, assignAddress, CMD, SENSOR_TYPE };
