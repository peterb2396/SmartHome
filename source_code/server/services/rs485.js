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
 * If the port errors out or closes (dongle unplugged/reseated, USB hiccup),
 * openTransport() is retried on a timer (RECONNECT_INTERVAL_MS) rather than
 * staying dead until the process restarts — see handleDisconnect()/
 * scheduleReconnect(). isBusDown() feeds faults.js the same way gpio.js's
 * isHvacFaultActive() does, only actually flagged as a fault on Linux (a
 * mock transport off the Pi during dev is normal, not a fault).
 *
 * ── Wire protocol ────────────────────────────────────────────────────────
 * Frame: [0xAA sync][addr 1B][cmd 1B][len 1B][payload...][crc8 1B]
 * addr 0x00 is reserved for broadcast / not-yet-configured nodes.
 *
 * Master → node:
 *   0x01 POLL             — request a report. Payload: none.
 *   0x02 ASSIGN            — broadcast only. Payload: [uniqueId 8B][newAddr 1B].
 *                            Only the node whose uniqueId matches adopts newAddr
 *                            and persists it to flash.
 *   0x03 SET_RELAY         — Payload: [relayIndex 1B][state 1B]. Unused today.
 *   0x04 POLL_DIAL         — dial-kind nodes only (see below), replaces POLL.
 *   0x05 POLL_ZONE_AUDIO   — zoneAudio-kind nodes only (see below), replaces POLL.
 *
 * Node → master:
 *   0x81 ANNOUNCE        — sent on addr 0x00 while unconfigured, every few
 *                          seconds. Payload: [uniqueId 8B][capabilities 1B].
 *   0x82 REPORT          — reply to POLL. Payload: repeated
 *                          [sensorType 1B][value float32 4B] tuples.
 *   0x83 ACK             — generic acknowledgement for ASSIGN/SET_RELAY.
 *   0x84 DIAL_STATE      — reply to POLL_DIAL (see below).
 *   0x85 ZONE_AUDIO_STATE — reply to POLL_ZONE_AUDIO (see below).
 *
 * Sensor type byte (REPORT payload):
 *   0x01 temperature (°F)   0x02 humidity (%RH)   0x03 pressure (hPa)
 *   0x04 voc (0-100 heuristic score)              0x05 co2 (ppm)
 *
 * ── Dial nodes (wall-mounted RS485 HMI: thermostat + sound control) ──────
 * A `kind: 'dial'` node (see nodeRegistry.js) is never touched by the
 * ordinary sensor pollAll()/POLL_INTERVAL_MS loop — it's polled on its own
 * much faster loop (pollAllDials(), no fixed sleep beyond each node's own
 * round-trip) so turning a physical dial feels instant, not laggy on a 10s
 * cycle. Nodes still only ever transmit in reply to a poll — never
 * unsolicited — same collision-avoidance rule as every other node type, so
 * this needed no change to the "master always initiates" design, just a
 * second poll loop.
 *
 * POLL_DIAL payload (master→dial, pushes what the dial should display for
 * BOTH screens every cycle, since the dial can switch screens locally
 * without waiting for a new poll — 25B): [targetF f32][currentF f32]
 * [humidity f32][co2 f32][outdoorF f32][flags 1B: bit0 callingHeat, bit1
 * callingCool, bit2 safetyActive, bit3 weatherStale, bit4
 * spotifyEnabled][hour 1B][minute 1B][volumePercent 1B][activeSource 1B:
 * 0=off,1=spotify,2=override1,3=override2] — volume/spotifyEnabled come
 * from sound.js's persisted per-zone settings; activeSource is that
 * zone's own audio hardware's CURRENT hardware-detected input (see the
 * zoneAudio section below), relayed through here purely so the dial can
 * display "now playing: TV" etc. — the dial has no say in it, same as the
 * web app.
 *
 * DIAL_STATE payload (dial→master reply, 8B): [mode 1B: 0=thermostat,
 * 1=sound][newTargetF f32][changed 1B][tapEvent 1B][newVolumePercent 1B].
 * Both newTargetF and newVolumePercent are the dial's own locally-tracked
 * ABSOLUTE values, never deltas — the master pushes the current value down
 * every cycle specifically so the dial always has a correct base to
 * increment from, which avoids the drift a delta-based approach would risk
 * if a frame is ever dropped. When changed=1, the master applies it
 * directly via thermostat.js's setZone() (mode=thermostat) or sound.js's
 * setZoneVolume() (mode=sound) — the exact same functions the web app's
 * own routes call, so there is one code path for "a zone's target/volume
 * changed" regardless of what changed it. This is also what makes the
 * whole HVAC-must-work-with-no-WiFi requirement hold up: dial → this bus →
 * setZone() → tick()/relay-drive never leaves the Pi.
 *
 * tapEvent values: 0=none, 1=wake (idle→clock), 2=menuSelect. 3=toggle
 * Spotify-enabled for this dial's sound zone — only acted on when
 * mode=sound (see pollAllDials()). This is strictly the same "zone on/off"
 * Spotify gate the web app's toggle is, never touches override inputs.
 *
 * ── Zone audio nodes (per-room amp hardware — NOT the dial, a separate
 * node) ────────────────────────────────────────────────────────────────
 * A `kind: 'zoneAudio'` node is the physical box driving one room's
 * speakers, with 3 audio inputs wired in and a FIXED, LOCAL priority
 * between them — see sound.js's header for the full design and why the
 * switching decision never touches this server. This bus's only job for
 * these nodes is carrying the Spotify-enable flag + volume down, and
 * carrying back which input the hardware is currently actually playing —
 * same "master polls, node only ever replies" rule as every other node
 * type, still folded into the ordinary 10s pollAll() cycle (not the dial's
 * fast loop) since nothing here needs sub-second responsiveness — the
 * actual audio switching already happened locally, instantly, independent
 * of this poll, by the time the poll even goes out.
 *
 * POLL_ZONE_AUDIO payload (master→zoneAudio, 2B): [spotifyEnabled 1B: 0/1]
 * [spotifyVolumePercent 1B].
 *
 * ZONE_AUDIO_STATE payload (zoneAudio→master reply, 1B): [activeSource 1B:
 * 0=off,1=spotify,2=override1,3=override2] — read straight into sound.js's
 * reportActiveSource(), which is display-only state, never fed back into a
 * command.
 */

const sensors = require('./sensorStore');
const { sendPush } = require('./mail');

const SYNC = 0xaa;
const CMD = {
  POLL: 0x01, ASSIGN: 0x02, SET_RELAY: 0x03, POLL_DIAL: 0x04, POLL_ZONE_AUDIO: 0x05,
  ANNOUNCE: 0x81, REPORT: 0x82, ACK: 0x83, DIAL_STATE: 0x84, ZONE_AUDIO_STATE: 0x85,
};
const ACTIVE_SOURCE_NAME = { 0: 'off', 1: 'spotify', 2: 'override1', 3: 'override2' };
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

// How long to wait for a REPORT after a POLL before giving up. Sized for a
// real sensor read, not a quick ack — the BME680's forced-mode conversion
// (oversampling + its ~150ms gas heater cycle) routinely runs past a couple
// hundred ms, and the node can't answer until that completes. Generous is
// fine here since it's nowhere near POLL_INTERVAL_MS (10s) either way.
const POLL_RESPONSE_TIMEOUT_MS = 2000;
const RECONNECT_INTERVAL_MS = 10000; // how often to retry opening the port after it's lost/never opened

// Dial nodes get their own much faster response timeout (they're a tiny
// microcontroller reacting to a queued input event, not a BME680 forced
// read) and a small gap between full sweeps of all dial nodes so an empty
// or single-dial bus doesn't spin a tight synchronous loop.
const DIAL_POLL_RESPONSE_TIMEOUT_MS = 200;
const DIAL_SWEEP_GAP_MS = 20;
const DIAL_MODE = { thermostat: 0, sound: 1 };
const DIAL_TAP_EVENT = { none: 0, wake: 1, menuSelect: 2, toggleSpotifyEnabled: 3 };
// tapEvent values other than toggleSpotifyEnabled are parsed but not acted
// on server-side — menu/mode navigation is entirely local to the dial's
// own UI state machine. Reserved protocol surface, same as SET_RELAY above.

// zoneAudio nodes reuse the sensor-rate 10s pollAll() loop, not the dial's
// fast loop — see this file's header for why sub-second responsiveness
// isn't needed here (the actual audio switching already happened locally
// on the node, independent of this poll).
const ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS = 2000;

let port = null;
let usingMock = true;
let reconnectTimer = null;
// True only once we're actually expected to have a real bus (Linux — see
// openTransport()) and it isn't open — a mock transport on a dev machine
// off the Pi is normal, not a fault, so that case never sets this.
let busDown = false;
const pendingNodes = new Map(); // uniqueId -> { uniqueId, lastSeenAt }
let rxBuffer = Buffer.alloc(0);
let pendingReportResolvers = new Map(); // address -> resolve fn, for the current in-flight POLL
let pendingDialResolvers = new Map(); // address -> resolve fn, for the current in-flight POLL_DIAL
let pendingZoneAudioResolvers = new Map(); // address -> resolve fn, for the current in-flight POLL_ZONE_AUDIO

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

// Edge-triggered, same pattern as gpio.js's HVAC fault handling — push once
// on the transition, not on every failed reconnect attempt while it stays
// down.
function setBusDown(down) {
  if (down === busDown) return;
  busDown = down;
  if (down) {
    console.warn('[RS485] Bus is down.');
    sendPush('The RS485 sensor bus is unreachable — zone sensors will stop updating until this recovers.', 'RS485: Bus Down');
  } else {
    console.log('[RS485] Bus back online.');
    sendPush('The RS485 sensor bus is back online.', 'RS485: Resolved');
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return; // already have one pending
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openTransport();
  }, RECONNECT_INTERVAL_MS);
}

// Fires on either a hard error or the port closing (e.g. the USB adapter
// being unplugged) — either way the connection is gone and needs a fresh
// open, not just logging.
function handleDisconnect(err) {
  if (err) console.error('[RS485] Serial error:', err.message);
  port = null;
  usingMock = true;
  if (process.platform === 'linux') setBusDown(true);
  scheduleReconnect();
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
      if (process.platform === 'linux') setBusDown(true);
      scheduleReconnect();
      return;
    }
    port = candidate;
    usingMock = false;
    setBusDown(false);
    port.on('data', onData);
    port.on('error', handleDisconnect);
    port.on('close', () => handleDisconnect(null));
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
    return;
  }
  if (cmd === CMD.DIAL_STATE) {
    const resolve = pendingDialResolvers.get(addr);
    if (!resolve || payload.length < 8) return;
    resolve({
      mode: payload[0],
      newTargetF: payload.readFloatLE(1),
      changed: !!payload[5],
      tapEvent: payload[6],
      newVolumePercent: payload[7],
    });
    pendingDialResolvers.delete(addr);
    return;
  }
  if (cmd === CMD.ZONE_AUDIO_STATE) {
    const resolve = pendingZoneAudioResolvers.get(addr);
    if (!resolve || payload.length < 1) return;
    resolve({ activeSource: payload[0] });
    pendingZoneAudioResolvers.delete(addr);
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────
// Logs every poll's outcome (response or timeout) so a bus that goes quiet
// after a while can actually be diagnosed from the logs — which node
// stopped answering, and when — instead of just observing "it stopped
// working" with no record of where.
let consecutiveMisses = new Map(); // busAddress -> count, reset to 0 on any response

function pollNode(address, zoneId) {
  return new Promise((resolve) => {
    if (usingMock) return resolve([]); // nothing to poll without real hardware
    const label = `addr=${address}${zoneId ? ` zone=${zoneId}` : ''}`;
    const timeout = setTimeout(() => {
      pendingReportResolvers.delete(address);
      const misses = (consecutiveMisses.get(address) || 0) + 1;
      consecutiveMisses.set(address, misses);
      console.warn(`[RS485] Poll ${label} — NO RESPONSE (timed out after ${POLL_RESPONSE_TIMEOUT_MS}ms, ${misses} in a row)`);
      resolve([]);
    }, POLL_RESPONSE_TIMEOUT_MS);
    pendingReportResolvers.set(address, (readings) => {
      clearTimeout(timeout);
      consecutiveMisses.set(address, 0);
      console.log(`[RS485] Poll ${label} — OK (${readings.length} readings)`);
      resolve(readings);
    });
    writeFrame(buildFrame(address, CMD.POLL));
  });
}

// zoneAudio nodes required lazily, same load-order reasoning as
// pollAllDials()'s thermostat/astro/sound requires below.
function pollZoneAudioNode(address, zoneId) {
  const soundSvc = require('./sound');
  return new Promise((resolve) => {
    if (usingMock) return resolve();
    const label = `addr=${address} soundZone=${zoneId}`;
    const { spotifyEnabled, volumePercent } = soundSvc.getZoneAudioPush(zoneId);
    const push = Buffer.from([spotifyEnabled ? 1 : 0, volumePercent]);
    const timeout = setTimeout(() => {
      pendingZoneAudioResolvers.delete(address);
      const misses = (consecutiveMisses.get(address) || 0) + 1;
      consecutiveMisses.set(address, misses);
      console.warn(`[RS485] Poll ${label} — NO RESPONSE (timed out after ${ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS}ms, ${misses} in a row)`);
      resolve();
    }, ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS);
    pendingZoneAudioResolvers.set(address, ({ activeSource }) => {
      clearTimeout(timeout);
      consecutiveMisses.set(address, 0);
      const sourceName = ACTIVE_SOURCE_NAME[activeSource] || 'off';
      console.log(`[RS485] Poll ${label} — OK (playing ${sourceName})`);
      soundSvc.reportActiveSource(zoneId, activeSource);
      resolve();
    });
    writeFrame(buildFrame(address, CMD.POLL_ZONE_AUDIO, push));
  });
}

async function pollAll(configuredNodes) {
  for (const node of configuredNodes) {
    if (node.busAddress == null) continue;
    if (node.kind === 'dial') continue; // dials only ever answer POLL_DIAL — handled by pollAllDials()'s own loop
    if (node.kind === 'zoneAudio') {
      if (!node.zoneId) continue;
      await pollZoneAudioNode(node.busAddress, node.zoneId);
      continue;
    }
    if (!node.zoneId) continue;
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

// ── Dial nodes — fast poll loop, separate from pollAll() above ─────────────
// thermostat.js/astro.js/sound.js required lazily (not at module top) to
// avoid any load-order coupling — rs485.js gets required very early
// (nodeRegistry.js requires it too), before those are guaranteed to have
// finished loading.
const SOUND_SOURCE_BYTE = { off: 0, spotify: 1, override1: 2, override2: 3 };

function buildDialPushPayload(zone, outdoor, soundZone, now) {
  const buf = Buffer.alloc(25);
  buf.writeFloatLE(zone?.target ?? 68, 0);
  buf.writeFloatLE(zone?.currentTemp ?? 0, 4);
  buf.writeFloatLE(zone?.environment?.humidity?.value ?? 0, 8);
  buf.writeFloatLE(zone?.environment?.co2?.value ?? 0, 12);
  buf.writeFloatLE(outdoor?.tempF ?? 0, 16);
  const flags = (zone?.calling ? 1 : 0) | (zone?.coolCalling ? 2 : 0) |
    (zone && zone.safety !== 'normal' ? 4 : 0) | (outdoor?.stale ? 8 : 0) |
    (soundZone?.spotifyEnabled ? 16 : 0);
  buf.writeUInt8(flags, 20);
  buf.writeUInt8(now.getHours(), 21);
  buf.writeUInt8(now.getMinutes(), 22);
  buf.writeUInt8(soundZone?.volumePercent ?? 0, 23);
  // Hardware-detected, relayed for display only — see this file's header.
  buf.writeUInt8(SOUND_SOURCE_BYTE[soundZone?.activeSource] ?? 0, 24);
  return buf;
}

// One full sweep of every configured dial node, applying any change it
// reports directly via thermostat.js's setZone() — the same function the
// web app's own zone-target route calls, so a dial's input and the web
// UI's input go through one identical code path. Runs back-to-back with a
// small gap (DIAL_SWEEP_GAP_MS), not on a fixed interval timer, so it
// can't overlap itself if a sweep ever runs long.
// Takes the same getConfiguredNodes callback init() does (not a resolved
// array) and re-calls it fresh every sweep — same reasoning as pollAll()
// above, so a dial added/removed via the Console mid-run is picked up on
// the very next sweep instead of needing a restart.
let dialSweepTimer = null;
async function pollAllDials(getConfiguredNodes) {
  const thermostatSvc = require('./thermostat');
  const astroSvc = require('./astro');
  const soundSvc = require('./sound');
  // A dial may drive a thermostat zone, a sound zone, or both — the two
  // are separate id spaces (see sound.js's header for why), so a dial
  // node carries both a `zoneId` (thermostat) and a `soundZoneId`. Either
  // may be unset; buildDialPushPayload()/the lookups below default
  // gracefully via optional chaining either way.
  const dialNodes = getConfiguredNodes().filter(n => n.kind === 'dial' && n.busAddress != null && (n.zoneId || n.soundZoneId));

  for (const node of dialNodes) {
    const zone = thermostatSvc.getState().zones.find(z => z.id === node.zoneId);
    const outdoor = astroSvc.getCachedOutdoorConditions();
    const soundZone = soundSvc.getState().zones.find(z => z.id === node.soundZoneId);
    if (!usingMock) writeFrame(buildFrame(node.busAddress, CMD.POLL_DIAL, buildDialPushPayload(zone, outdoor, soundZone, new Date())));

    const reply = await new Promise((resolve) => {
      if (usingMock) return resolve(null);
      const timeout = setTimeout(() => { pendingDialResolvers.delete(node.busAddress); resolve(null); }, DIAL_POLL_RESPONSE_TIMEOUT_MS);
      pendingDialResolvers.set(node.busAddress, (state) => { clearTimeout(timeout); resolve(state); });
    });
    if (!reply) continue;

    // Strictly the Spotify-enable gate — see sound.js's header. Checked
    // independent of `changed`, which is only about the volume value.
    if (reply.mode === DIAL_MODE.sound && reply.tapEvent === DIAL_TAP_EVENT.toggleSpotifyEnabled && node.soundZoneId) {
      try {
        const current = soundSvc.getState().zones.find(z => z.id === node.soundZoneId);
        await soundSvc.setZoneEnabled(node.soundZoneId, !current?.spotifyEnabled);
      } catch (err) {
        console.warn(`[RS485] Dial ${node.uniqueId} enable-toggle rejected:`, err.message);
      }
    }

    if (!reply.changed) continue;
    try {
      if (reply.mode === DIAL_MODE.thermostat && node.zoneId) {
        await thermostatSvc.setZone(node.zoneId, { target: reply.newTargetF });
      } else if (reply.mode === DIAL_MODE.sound && node.soundZoneId) {
        await soundSvc.setZoneVolume(node.soundZoneId, reply.newVolumePercent);
      }
    } catch (err) {
      console.warn(`[RS485] Dial ${node.uniqueId} change rejected:`, err.message);
    }
  }

  dialSweepTimer = setTimeout(() => pollAllDials(getConfiguredNodes), DIAL_SWEEP_GAP_MS);
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
  pollAllDials(getConfiguredNodes); // self-reschedules — see its own comment
  console.log('[RS485] Service initialized.');
}

function isBusDown() {
  return busDown;
}

module.exports = { init, getPending, assignAddress, isBusDown, CMD, SENSOR_TYPE, DIAL_MODE };
