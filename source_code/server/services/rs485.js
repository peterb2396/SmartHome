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
 * A dial is not a separate physical node on this bus — see nodeRegistry.js's
 * `hasDial` field. The actual RS485 node is the SAME mass-produced RP2040
 * board used for every zone's sensors; the dial (an ESP32-based touch +
 * rotary display) is an I2C ACCESSORY hanging off that RP2040, exactly like
 * the BME680/SCD41 sensors are — the RP2040 bridges between RS485 (talking
 * to this server) and I2C (talking to the dial), and answers on ONE shared
 * bus address for BOTH roles: POLL/REPORT for its own sensors (if it has
 * any — see `kind`) and POLL_DIAL/DIAL_STATE for the attached dial (if
 * `hasDial` is true). This keeps the RS485 side of things exactly as
 * simple as every other node type ("master always initiates, node only
 * ever replies") — the ESP32 dial itself never touches RS485 at all, or
 * even needs to know the protocol exists; the RP2040 handles all of that
 * and just gives the dial a small I2C register interface to read/write.
 *
 * Dial polling still runs on its own much faster loop (pollAllDials(), no
 * fixed sleep beyond each node's own round-trip) than the ordinary 10s
 * sensor pollAll() loop, so turning the physical dial feels instant, not
 * laggy — but since a `hasDial` node's SAME bus address can now be visited
 * by EITHER loop, and RS485 is a shared half-duplex bus where only one
 * request can be outstanding at a time, both loops check a shared
 * per-address busy set (see pollingAddresses below) before writing to an
 * address and simply skip that node for this pass if it's already
 * mid-exchange with the other loop — cheap for the fast dial loop (tries
 * again in DIAL_SWEEP_GAP_MS), and pollAll() only ever needs this once per
 * 10s so a skipped cycle there is a non-issue.
 *
 * POLL_DIAL payload (master→dial, pushes what the dial should display for
 * every screen every cycle, since the dial can switch screens locally
 * without waiting for a new poll — 27B): [targetF f32][currentF f32]
 * [humidity f32][co2 f32][outdoorF f32][flags 1B: bit0 callingHeat, bit1
 * callingCool, bit2 safetyActive, bit3 weatherStale, bit4
 * spotifyEnabled][hour 1B][minute 1B][volumePercent 1B][activeSource 1B:
 * 0=off,1=spotify,2=override1,3=override2][faultCount 1B]
 * [maintenanceDueCount 1B]. volume/spotifyEnabled come from sound.js's
 * persisted per-zone settings; activeSource is that zone's own audio
 * hardware's CURRENT hardware-detected input (see the zoneAudio section
 * below), relayed through here purely so the dial can display "now
 * playing: TV" etc. — the dial has no say in it, same as the web app.
 * faultCount/maintenanceDueCount are plain counts (from faults.js/
 * maintenance.js, same numbers the Console/Maintenance pages show) for an
 * ambient badge — the dial deliberately never renders fault/maintenance
 * TEXT (no room on a round face, and it'd duplicate the web app's detail
 * view); it just flags "go check the app" when either is nonzero. Same
 * for every dial in a sweep, not per-zone.
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
 * tapEvent values: 0=none, 1=wake (idle→clock), 2=menuSelect, 4=returnToMenu
 * (tapped/pressed on Thermostat or Status, both purely local dial-side
 * navigation, same as wake/menuSelect — never acted on server-side). 3=
 * toggle Spotify-enabled for this dial's sound zone — only acted on when
 * mode=sound (see pollAllDials()). This is strictly the same "zone on/off"
 * Spotify gate the web app's toggle is, never touches override inputs.
 *
 * ── Zone audio nodes (per-room amp hardware — NOT the dial, a separate
 * node) ────────────────────────────────────────────────────────────────
 * A `kind: 'zoneAudio'` node is the physical box driving one room's
 * speakers, with 2 audio inputs wired in — a LOCAL one (that zone's TV/
 * override1, physically only present in that room) and a SHARED one (the
 * Pi's own line-out, distributed to every zone node — see hardware.md /
 * the hardware doc for the physical distribution-amp design) — and a
 * FIXED, LOCAL priority between them, decided entirely on the node, see
 * sound.js's header for the full design and why the switching decision
 * never touches this server.
 *
 * The shared Pi input carries EITHER Spotify OR an announcement — never
 * both, same "one stream" limit as Spotify alone already has (see
 * spotify.js's header) — so which one it currently means for THIS zone's
 * priority purposes is a per-zone flag this server pushes down, not
 * something the node can infer from the audio alone: with spotifyEnabled
 * set it's tier-0 (loses to the local override1 input); with
 * announcementActive set it's tier-2 (wins over everything, including
 * override1) — that's what makes "announce to specific zones,
 * programmatically" actually work: targeting a zone is nothing more than
 * setting its announcementActive flag, the same RS485 push that already
 * carries spotifyEnabled. Playing the actual announcement audio (pausing
 * Spotify on the Pi's output, feeding the message in) is a separate,
 * not-yet-built piece — see sound.js's setAnnouncementTargets() for
 * exactly where that gets wired in later; the protocol/plumbing here is
 * ready for it now so the hardware doc doesn't describe a system that
 * doesn't match what's actually built.
 *
 * This bus's job for these nodes is carrying spotifyEnabled/
 * announcementActive/volume down, and carrying back which input the
 * hardware is currently actually playing — same "master polls, node only
 * ever replies" rule as every other node type, still folded into the
 * ordinary 10s pollAll() cycle (not the dial's fast loop) since nothing
 * here needs sub-second responsiveness — the actual audio switching
 * already happened locally, instantly, independent of this poll, by the
 * time the poll even goes out.
 *
 * POLL_ZONE_AUDIO payload (master→zoneAudio, 2B): [flags 1B: bit0
 * spotifyEnabled, bit1 announcementActive][spotifyVolumePercent 1B].
 *
 * ZONE_AUDIO_STATE payload (zoneAudio→master reply, 1B): [activeSource 1B:
 * 0=off,1=spotify,2=override1,3=override2 — override2 here means "the
 * shared Pi input, at announcement priority," not a second physical
 * input] — read straight into sound.js's reportActiveSource(), which is
 * display-only state, never fed back into a command.
 *
 * ── Remote firmware update (RP2040 nodes only — see firmwareUpdate.js) ───
 * The Pi has no USB wire to a deployed node, only this RS485 pair — so
 * "flash it remotely" means pushing a new image over the SAME half-duplex
 * bus normal polling uses, in small chunks, and having the node install it
 * itself. Node-side this rides arduino-pico's Update library (same shape
 * as ESP32/ESP8266's): the new image goes into an inactive flash
 * partition and is only marked bootable after a clean finish, so an
 * interrupted or corrupt push leaves the node running its OLD firmware,
 * not bricked — that safety only holds if the node was BUILT with an
 * OTA-enabled "Flash Size" partition scheme in the Arduino IDE, which is
 * a one-time per-node manual-USB-flash requirement, not something this
 * protocol can do for a node that doesn't already have it.
 *
 * This protocol layer adds its OWN whole-image CRC32 check (below,
 * independent of whatever Update.end() itself verifies) specifically so
 * correctness doesn't depend on exactly matching some Updater library
 * version's internal behavior — FW_BEGIN carries the sender's expected
 * CRC32, the node accumulates its own running CRC32 over every byte
 * written, and FW_END only finalizes/reboots if they match.
 *
 * One flash runs at a time, one node at a time — reuses pollingAddresses
 * (see above) so an in-progress push simply excludes that address from
 * normal polling until it finishes or times out; every OTHER node keeps
 * polling normally throughout. At 9600 baud, half-duplex, one small chunk
 * per round trip, a few-hundred-KB image realistically takes low single
 * digit MINUTES — see flashFirmware()'s own comment before assuming
 * something's stuck.
 *
 * 0x06 FW_BEGIN  (master→node) — payload: [totalSize u32][crc32 u32] (8B).
 *                  Node calls Update.begin(totalSize), resets its running
 *                  CRC32 accumulator. Replies FW_ACK stage=0.
 * 0x07 FW_CHUNK  (master→node) — payload: [seq u16][data...] (up to
 *                  FW_CHUNK_DATA_LEN=32B data). Node calls
 *                  Update.write(data, len), folds data into the running
 *                  CRC32. Replies FW_ACK stage=1, echoing seq.
 * 0x08 FW_END    (master→node) — payload: none. Node compares its
 *                  running CRC32 against the one FW_BEGIN sent; if it
 *                  matches, calls Update.end(true) and — only if THAT also
 *                  reports success — replies FW_ACK stage=2 ok=1 and
 *                  reboots into the new image; on any mismatch it replies
 *                  ok=0 and keeps running the current firmware, untouched.
 * 0x09 GET_LOG   (master→node) — payload: none. Node replies LOG_LINE with
 *                  its next buffered debug line, if any queued — see
 *                  rs485_node.ino's logLine() — so field debug output
 *                  (BME680/SCD41 not found, dial I2C errors, etc.) is
 *                  visible from the Console's existing log Terminal panel
 *                  without a USB cable, tagged by node name (see
 *                  pollNodeLog() below). Polled slowly and round-robin
 *                  (LOG_POLL_INTERVAL_MS/one node per tick) — this is
 *                  debug convenience, not control traffic, and
 *                  deliberately kept cheap on bus time.
 *
 * 0x86 FW_ACK    (node→master) — payload: [stage 1B][ok 1B][seq u16 — only
 *                  meaningful for stage=1, echoes the chunk seq].
 * 0x87 LOG_LINE  (node→master) — payload: [hasLine 1B][text...] (up to
 *                  30B, UTF-8/ASCII). hasLine=0 with no text means nothing
 *                  was queued this poll.
 */

const sensors = require('./sensorStore');
const { sendPush } = require('./mail');

const SYNC = 0xaa;
const CMD = {
  POLL: 0x01, ASSIGN: 0x02, SET_RELAY: 0x03, POLL_DIAL: 0x04, POLL_ZONE_AUDIO: 0x05,
  FW_BEGIN: 0x06, FW_CHUNK: 0x07, FW_END: 0x08, GET_LOG: 0x09,
  ANNOUNCE: 0x81, REPORT: 0x82, ACK: 0x83, DIAL_STATE: 0x84, ZONE_AUDIO_STATE: 0x85,
  FW_ACK: 0x86, LOG_LINE: 0x87,
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
const DIAL_TAP_EVENT = { none: 0, wake: 1, menuSelect: 2, toggleSpotifyEnabled: 3, returnToMenu: 4 };
// tapEvent values other than toggleSpotifyEnabled are parsed but not acted
// on server-side — menu/mode navigation is entirely local to the dial's
// own UI state machine. Reserved protocol surface, same as SET_RELAY above.

// zoneAudio nodes reuse the sensor-rate 10s pollAll() loop, not the dial's
// fast loop — see this file's header for why sub-second responsiveness
// isn't needed here (the actual audio switching already happened locally
// on the node, independent of this poll).
const ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS = 2000;

// ── Remote firmware update — see this file's header for the protocol ────
const FW_CHUNK_DATA_LEN = 32; // + 2B seq = 34B payload, under MAX_PAYLOAD_LEN (40)
const FW_BEGIN_TIMEOUT_MS = 3000; // Update.begin() may erase flash — give it room
const FW_CHUNK_TIMEOUT_MS = 2000; // Update.write() can cross a sector boundary and erase
const FW_END_TIMEOUT_MS = 6000; // finalize + verify + (on success) the node reboots itself
const FW_CHUNK_RETRIES = 5; // a dropped chunk is just re-sent, not a fatal abort

// Debug-convenience only (see GET_LOG in this file's header) — deliberately
// slow and one node per tick so this never competes meaningfully with real
// polling for bus time.
const LOG_POLL_INTERVAL_MS = 3000;
const LOG_POLL_RESPONSE_TIMEOUT_MS = 500;

// Standard CRC-32 (IEEE 802.3 / zlib) — must match crc32Update() in
// rs485_node.ino/zone_audio_node.ino bit-for-bit, since FW_END's whole-image
// check is only meaningful if both sides compute the identical value.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// onData()'s resync safety net — see its own comment for the failure mode
// this guards against. Largest real payload today is POLL_DIAL's 27B;
// generous headroom over that so a legitimate future protocol addition
// doesn't false-positive against this.
const MAX_PAYLOAD_LEN = 40;
// NOT just wire-transmission time (9600 baud is ~1ms/byte, which alone
// would suggest well under 50ms) — real USB-to-RS485 adapters/OS serial
// drivers can legitimately deliver one genuine frame's bytes split across
// multiple 'data' events with real gaps between them well past that,
// independent of how fast the node actually replied. An earlier version
// of this used 300ms and it was WRONG: it fired on real in-progress
// frames, not just noise, discarding their sync byte before the rest
// arrived — turned "occasional timeout after hours" into "every poll
// fails immediately." This only needs to be shorter than the time before
// enough new traffic queues up behind a truly-dead byte to matter, so it
// stays comfortably above POLL_RESPONSE_TIMEOUT_MS (2000ms) — a real
// per-node round trip, including any driver buffering delay, should never
// get close to this.
const FRAME_STALL_MS = 3000;

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
let pendingFwResolvers = new Map(); // address -> resolve fn, for the current in-flight FW_BEGIN/CHUNK/END
let pendingLogResolvers = new Map(); // address -> resolve fn, for the current in-flight GET_LOG

// A combined sensor+dial node (nodeRegistry.js's `hasDial`) answers both
// pollAll()'s 10s sensor sweep and pollAllDials()'s ~20ms dial sweep on the
// SAME bus address — since RS485 only allows one outstanding request at a
// time, both sweeps check this set before writing to an address and skip
// it for this pass (not wait) if it's already mid-exchange with the other
// sweep. See this file's header ("Dial nodes") for the full reasoning.
const pollingAddresses = new Set();

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

// `verbose` lets a caller opt into a raw hex dump for this specific write —
// used at the same shouldLogMiss() checkpoints as the "NO RESPONSE"
// warnings, so a sustained outage's log shows real TX bytes going out at
// the exact moments it also shows the timeout, instead of either logging
// every single write forever (the old, buffer-flooding behavior) or
// having zero TX evidence at all during an outage.
function writeFrame(frame, verbose = false) {
  if (usingMock || !port) {
    console.log(`[RS485 Mock] would write ${frame.length}B frame: ${frame.toString('hex')}`);
    return;
  }
  if (verbose) console.log(`[RS485] TX ${frame.length}B: ${frame.toString('hex')}`);
  port.write(frame);
}

// ── Frame parsing ────────────────────────────────────────────────────────
// Tracks when the byte currently sitting at rxBuffer's front first started
// looking like the start of an in-progress frame — reset to null whenever
// a frame completes/gets skipped, i.e. whenever progress is made.
let awaitingFrameSince = null;

function onData(chunk) {
  // Raw, unparsed — the one log line that can tell "nothing at all came
  // back" apart from "something came back but didn't parse right." Every
  // chunk, not just complete frames, so a garbled/partial reply is visible
  // too. Unthrottled, unlike TX/NO-RESPONSE — this only ever fires when
  // bytes actually arrive, which is exactly the rare, valuable case during
  // an outage (self-limiting: if truly nothing comes back, this simply
  // never logs, no flooding risk).
  console.log(`[RS485] RX ${chunk.length}B: ${chunk.toString('hex')}`);
  rxBuffer = Buffer.concat([rxBuffer, chunk]);
  let syncIdx;
  while ((syncIdx = rxBuffer.indexOf(SYNC)) !== -1) {
    // A stray byte that happens to equal SYNC (bus noise, or just landing
    // inside another frame's payload) can make everything from here look
    // like the start of a frame that will never actually complete. Left
    // unchecked, indexOf(SYNC) keeps re-finding this same dead position on
    // every future call forever — no amount of reopening the serial port
    // or resetting the remote node clears rxBuffer, only a process
    // restart reallocates it, which is exactly the "only fix is
    // restarting the backend" symptom this guards against. Two checks:
    // an implausible len skips immediately, a plausible-but-never-
    // completing one times out after FRAME_STALL_MS of no progress.
    const len = rxBuffer.length > syncIdx + 3 ? rxBuffer[syncIdx + 3] : null;
    if (len !== null && len > MAX_PAYLOAD_LEN) {
      rxBuffer = rxBuffer.subarray(syncIdx + 1);
      awaitingFrameSince = null;
      continue;
    }

    if (rxBuffer.length < syncIdx + 4) { // not enough for header yet
      if (awaitingFrameSince === null) awaitingFrameSince = Date.now();
      else if (Date.now() - awaitingFrameSince > FRAME_STALL_MS) {
        rxBuffer = rxBuffer.subarray(syncIdx + 1);
        awaitingFrameSince = null;
        continue;
      }
      return;
    }
    const addr = rxBuffer[syncIdx + 1];
    const cmd = rxBuffer[syncIdx + 2];
    const frameEnd = syncIdx + 4 + len + 1;
    if (rxBuffer.length < frameEnd) { // wait for the rest
      if (awaitingFrameSince === null) awaitingFrameSince = Date.now();
      else if (Date.now() - awaitingFrameSince > FRAME_STALL_MS) {
        rxBuffer = rxBuffer.subarray(syncIdx + 1);
        awaitingFrameSince = null;
        continue;
      }
      return;
    }

    const payload = rxBuffer.subarray(syncIdx + 4, syncIdx + 4 + len);
    const receivedCrc = rxBuffer[frameEnd - 1];
    const expectedCrc = crc8(rxBuffer.subarray(syncIdx + 1, syncIdx + 4 + len));
    rxBuffer = rxBuffer.subarray(frameEnd);
    awaitingFrameSince = null;

    if (receivedCrc !== expectedCrc) {
      console.warn('[RS485] CRC mismatch, dropping frame.');
      continue;
    }
    handleFrame(addr, cmd, payload);
  }
}

// onData() only re-checks the stall timeout when new bytes actually
// arrive — if the bus goes fully silent after the stuck byte (no further
// noise at all), onData() never fires again and the timeout above never
// gets evaluated. Called once per pollAll() cycle (already runs every
// POLL_INTERVAL_MS regardless of bus traffic) so a stuck buffer self-heals
// even without anything new coming in over the wire.
function checkFrameStall() {
  if (awaitingFrameSince === null) return;
  if (Date.now() - awaitingFrameSince <= FRAME_STALL_MS) return;
  const syncIdx = rxBuffer.indexOf(SYNC);
  rxBuffer = syncIdx === -1 ? Buffer.alloc(0) : rxBuffer.subarray(syncIdx + 1);
  awaitingFrameSince = null;
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
    return;
  }
  if (cmd === CMD.FW_ACK) {
    const resolve = pendingFwResolvers.get(addr);
    if (!resolve || payload.length < 2) return;
    resolve({ stage: payload[0], ok: !!payload[1], seq: payload.length >= 4 ? payload.readUInt16LE(2) : null });
    pendingFwResolvers.delete(addr);
    return;
  }
  if (cmd === CMD.LOG_LINE) {
    const resolve = pendingLogResolvers.get(addr);
    if (!resolve || payload.length < 1) return;
    const hasLine = !!payload[0];
    resolve(hasLine ? payload.subarray(1).toString('utf8').replace(/\0+$/, '') : null);
    pendingLogResolvers.delete(addr);
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────
// Logs every poll's outcome (response or timeout) so a bus that goes quiet
// after a while can actually be diagnosed from the logs — which node
// stopped answering, and when — instead of just observing "it stopped
// working" with no record of where.
let consecutiveMisses = new Map(); // busAddress -> count, reset to 0 on any response

// A sustained outage logging one warning every single 10s cycle, forever,
// is what buried an entire day's worth of every other service's logs
// under ~3800 identical "NO RESPONSE" lines and made it impossible to see
// what actually happened at the moment it started — see git history.
// Full detail for the first several misses (exactly when it started
// matters most), then backing off to periodic checkpoints, keeps a long
// outage from crowding the ring buffer out while still leaving a trail.
function shouldLogMiss(misses) {
  if (misses <= 5) return true;
  if (misses < 50) return misses % 10 === 0;
  if (misses < 500) return misses % 50 === 0;
  return misses % 500 === 0;
}

function pollNode(address, zoneId) {
  return new Promise((resolve) => {
    if (usingMock) return resolve([]); // nothing to poll without real hardware
    // A hasDial node's address might already be mid-exchange with
    // pollAllDials()'s dial sweep — skip this node for THIS 10s cycle
    // rather than risk two outstanding requests on the same half-duplex
    // bus at once. Cheap: it just tries again next cycle.
    if (pollingAddresses.has(address)) return resolve([]);
    pollingAddresses.add(address);
    const label = `addr=${address}${zoneId ? ` zone=${zoneId}` : ''}`;
    const timeout = setTimeout(() => {
      pendingReportResolvers.delete(address);
      pollingAddresses.delete(address);
      const misses = (consecutiveMisses.get(address) || 0) + 1;
      consecutiveMisses.set(address, misses);
      if (shouldLogMiss(misses)) {
        console.warn(`[RS485] Poll ${label} — NO RESPONSE (timed out after ${POLL_RESPONSE_TIMEOUT_MS}ms, ${misses} in a row)`);
      }
      resolve([]);
    }, POLL_RESPONSE_TIMEOUT_MS);
    pendingReportResolvers.set(address, (readings) => {
      clearTimeout(timeout);
      pollingAddresses.delete(address);
      // The single most useful line in a long outage: exactly when it
      // ended and how long it ran, logged unconditionally (unlike the
      // routine per-poll success case, which stays silent either way).
      const priorMisses = consecutiveMisses.get(address) || 0;
      if (priorMisses > 0) {
        console.log(`[RS485] Poll ${label} — RECOVERED after ${priorMisses} consecutive misses`);
      }
      consecutiveMisses.set(address, 0);
      resolve(readings);
    });
    // Predicts whether THIS attempt, if it times out, would land on a
    // shouldLogMiss() checkpoint — so the TX hex dump and the eventual
    // "NO RESPONSE, N in a row" warning it corresponds to show up
    // together, not logged independently of each other.
    const prospectiveMisses = (consecutiveMisses.get(address) || 0) + 1;
    writeFrame(buildFrame(address, CMD.POLL), shouldLogMiss(prospectiveMisses));
  });
}

// zoneAudio nodes required lazily, same load-order reasoning as
// pollAllDials()'s thermostat/astro/sound requires below.
function pollZoneAudioNode(address, zoneId) {
  const soundSvc = require('./sound');
  return new Promise((resolve) => {
    if (usingMock) return resolve();
    const label = `addr=${address} soundZone=${zoneId}`;
    const { spotifyEnabled, announcementActive, volumePercent } = soundSvc.getZoneAudioPush(zoneId);
    const flags = (spotifyEnabled ? 1 : 0) | (announcementActive ? 2 : 0);
    const push = Buffer.from([flags, volumePercent]);
    const timeout = setTimeout(() => {
      pendingZoneAudioResolvers.delete(address);
      const misses = (consecutiveMisses.get(address) || 0) + 1;
      consecutiveMisses.set(address, misses);
      if (shouldLogMiss(misses)) {
        console.warn(`[RS485] Poll ${label} — NO RESPONSE (timed out after ${ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS}ms, ${misses} in a row)`);
      }
      resolve();
    }, ZONE_AUDIO_POLL_RESPONSE_TIMEOUT_MS);
    pendingZoneAudioResolvers.set(address, ({ activeSource }) => {
      clearTimeout(timeout);
      const priorMisses = consecutiveMisses.get(address) || 0;
      if (priorMisses > 0) {
        const sourceName = ACTIVE_SOURCE_NAME[activeSource] || 'off';
        console.log(`[RS485] Poll ${label} — RECOVERED after ${priorMisses} consecutive misses (now playing ${sourceName})`);
      }
      consecutiveMisses.set(address, 0);
      soundSvc.reportActiveSource(zoneId, activeSource);
      resolve();
    });
    writeFrame(buildFrame(address, CMD.POLL_ZONE_AUDIO, push));
  });
}

// ── Remote firmware update ──────────────────────────────────────────────
// One request/reply exchange over the FW_* protocol — mirrors pollNode()'s
// shape (promise + timeout + pendingFwResolvers) but generic over which
// frame gets sent, since FW_BEGIN/FW_CHUNK/FW_END are all "send one frame,
// await one FW_ACK" with different timeouts.
function fwExchange(address, frame, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingFwResolvers.delete(address);
      resolve(null);
    }, timeoutMs);
    pendingFwResolvers.set(address, (ack) => {
      clearTimeout(timeout);
      resolve(ack);
    });
    writeFrame(frame, true); // OTA traffic is rare and important enough to always log
  });
}

// Pushes `buffer` (a full firmware .bin) to `address` over RS485, one
// FW_CHUNK_DATA_LEN chunk at a time. Claims `address` in pollingAddresses
// for the whole operation — see this file's header — so normal polling of
// THIS node pauses until it finishes (expected: it's about to reboot) while
// every other node keeps polling normally. Resolves true only if FW_END
// both CRC-matched and the node's own Update.end() reported success; false
// for anything else (timeout, NACK, CRC mismatch) — in every false case the
// node is defined to still be running its OLD firmware untouched, so a
// caller can just retry the whole push.
//
// Speed reality check: 9600 baud, half-duplex, one small chunk per round
// trip (send + node's Update.write() + ack) — figure roughly 100-150ms per
// chunk including driver/turnaround overhead, so a 300KB image (~9,400
// chunks at 32B) is realistically several minutes, not seconds. onProgress
// (if given) is called after every chunk with {sent, total} so a caller can
// show real progress instead of a spinner with no sense of how long this
// legitimately takes.
async function flashFirmware(address, buffer, onProgress) {
  if (usingMock) return false;
  if (pollingAddresses.has(address)) return false; // already mid-exchange with something else
  pollingAddresses.add(address);
  try {
    const totalCrc = crc32(buffer);
    const beginPayload = Buffer.alloc(8);
    beginPayload.writeUInt32LE(buffer.length, 0);
    beginPayload.writeUInt32LE(totalCrc, 4);
    const beginAck = await fwExchange(address, buildFrame(address, CMD.FW_BEGIN, beginPayload), FW_BEGIN_TIMEOUT_MS);
    if (!beginAck || !beginAck.ok) return false;

    let seq = 0;
    for (let offset = 0; offset < buffer.length; offset += FW_CHUNK_DATA_LEN) {
      const data = buffer.subarray(offset, offset + FW_CHUNK_DATA_LEN);
      const chunkPayload = Buffer.concat([Buffer.alloc(2), data]);
      chunkPayload.writeUInt16LE(seq, 0);
      const frame = buildFrame(address, CMD.FW_CHUNK, chunkPayload);

      let ack = null;
      for (let attempt = 0; attempt < FW_CHUNK_RETRIES && !ack; attempt++) {
        const reply = await fwExchange(address, frame, FW_CHUNK_TIMEOUT_MS);
        if (reply && reply.ok && reply.seq === seq) ack = reply;
      }
      if (!ack) return false; // exhausted retries — node unresponsive mid-transfer

      seq++;
      if (onProgress) onProgress({ sent: Math.min(offset + FW_CHUNK_DATA_LEN, buffer.length), total: buffer.length });
    }

    const endAck = await fwExchange(address, buildFrame(address, CMD.FW_END), FW_END_TIMEOUT_MS);
    return !!(endAck && endAck.ok);
  } finally {
    pollingAddresses.delete(address);
  }
}

// ── Node debug-log relay — see GET_LOG in this file's header ───────────
// One node per tick, round-robin, deliberately slow — this is debug
// convenience riding along on production bus time, not control traffic.
let logPollCursor = 0;
let logPollTimer = null;
async function pollNodeLog(getConfiguredNodes) {
  const nodes = getConfiguredNodes().filter(n => n.busAddress != null);
  if (nodes.length === 0 || usingMock) {
    logPollTimer = setTimeout(() => pollNodeLog(getConfiguredNodes), LOG_POLL_INTERVAL_MS);
    return;
  }
  const node = nodes[logPollCursor % nodes.length];
  logPollCursor++;

  if (!pollingAddresses.has(node.busAddress)) {
    pollingAddresses.add(node.busAddress);
    const line = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingLogResolvers.delete(node.busAddress);
        resolve(null);
      }, LOG_POLL_RESPONSE_TIMEOUT_MS);
      pendingLogResolvers.set(node.busAddress, (text) => {
        clearTimeout(timeout);
        resolve(text);
      });
      writeFrame(buildFrame(node.busAddress, CMD.GET_LOG));
    });
    pollingAddresses.delete(node.busAddress);
    // sourceFor() in logStream.js groups by the leading [Bracket] — this
    // makes each node's field debug output show up as its own source in
    // the Console's existing Terminal panel, no new UI needed.
    if (line) console.log(`[Node:${node.name}] ${line}`);
  }

  logPollTimer = setTimeout(() => pollNodeLog(getConfiguredNodes), LOG_POLL_INTERVAL_MS);
}

async function pollAll(configuredNodes) {
  checkFrameStall();
  for (const node of configuredNodes) {
    if (node.busAddress == null) continue;
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

function buildDialPushPayload(zone, outdoor, soundZone, now, faultCount, maintenanceDueCount) {
  const buf = Buffer.alloc(27);
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
  // Purely a glanceable count for an ambient badge — the dial never shows
  // fault/maintenance TEXT (no room on a round 480x480 face for arbitrary
  // strings, and it'd mean duplicating faults.js's/maintenance.js's detail
  // rendering in firmware); "go check the app" is the answer either way,
  // this just tells the dial whether it should say so.
  buf.writeUInt8(Math.min(faultCount ?? 0, 255), 25);
  buf.writeUInt8(Math.min(maintenanceDueCount ?? 0, 255), 26);
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
  // A dial may drive a thermostat zone, a sound zone, or both — the two
  // are separate id spaces (see sound.js's header for why), so a dial
  // node carries both a `zoneId` (thermostat) and a `soundZoneId`. Either
  // may be unset; buildDialPushPayload()/the lookups below default
  // gracefully via optional chaining either way. `hasDial` is independent
  // of `kind` — see nodeRegistry.js — so this node may ALSO be a sensor
  // node pollAll() visits on its own 10s cycle, same bus address.
  const dialNodes = getConfiguredNodes().filter(n => n.hasDial && n.busAddress != null && (n.zoneId || n.soundZoneId));

  // This function reschedules itself every DIAL_SWEEP_GAP_MS (20ms)
  // forever, regardless of dial count — with zero dials that's 50
  // no-op ticks/sec, which was already true before fault/maintenance
  // counts existed. Bail out BEFORE doing any real work (the requires
  // below, and especially faultsSvc.getFaults()/maintenanceSvc.getState(),
  // which each walk thermostat/gpio/lutron/bus state) — running those 50
  // times a second with nothing to send them to is real, continuous
  // Node event-loop load on a Pi, easily enough to starve the RS485
  // serial port's own data callback and make sensor polls start timing
  // out even though bytes are arriving fine at the OS level. Learned this
  // the hard way — see git history for the incident.
  if (dialNodes.length === 0) {
    dialSweepTimer = setTimeout(() => pollAllDials(getConfiguredNodes), DIAL_SWEEP_GAP_MS);
    return;
  }

  const thermostatSvc = require('./thermostat');
  const astroSvc = require('./astro');
  const soundSvc = require('./sound');
  const faultsSvc = require('./faults');
  const maintenanceSvc = require('./maintenance');
  // Same for every dial in this sweep — computed once, not per node.
  const faultCount = faultsSvc.getFaults().length;
  const maintenanceDueCount = maintenanceSvc.getState().tasks.filter(t => t.isDue).length;

  for (const node of dialNodes) {
    // This address might currently be mid-exchange with pollAll()'s
    // sensor sweep (only possible for a combined sensor+dial node) —
    // skip it for this pass rather than risk two outstanding requests on
    // the same half-duplex bus. Costs nothing here: tries again in
    // DIAL_SWEEP_GAP_MS (~20ms), and a real sensor exchange is at most a
    // couple hundred ms, so this only ever costs a handful of sweeps.
    if (pollingAddresses.has(node.busAddress)) continue;

    const zone = thermostatSvc.getState().zones.find(z => z.id === node.zoneId);
    const outdoor = astroSvc.getCachedOutdoorConditions();
    const soundZone = soundSvc.getState().zones.find(z => z.id === node.soundZoneId);
    if (!usingMock) {
      pollingAddresses.add(node.busAddress);
      writeFrame(buildFrame(node.busAddress, CMD.POLL_DIAL, buildDialPushPayload(zone, outdoor, soundZone, new Date(), faultCount, maintenanceDueCount)));
    }

    const reply = await new Promise((resolve) => {
      if (usingMock) return resolve(null);
      const timeout = setTimeout(() => {
        pendingDialResolvers.delete(node.busAddress);
        pollingAddresses.delete(node.busAddress);
        resolve(null);
      }, DIAL_POLL_RESPONSE_TIMEOUT_MS);
      pendingDialResolvers.set(node.busAddress, (state) => {
        clearTimeout(timeout);
        pollingAddresses.delete(node.busAddress);
        resolve(state);
      });
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
  pollNodeLog(getConfiguredNodes); // self-reschedules — see its own comment
  console.log('[RS485] Service initialized.');
}

function isBusDown() {
  return busDown;
}

// address must currently be idle (not mid-poll/mid-dial-sweep) — callers
// needing a node's live busAddress should read it from nodeRegistry, same
// as everywhere else in this codebase.
module.exports = { init, getPending, assignAddress, isBusDown, flashFirmware, CMD, SENSOR_TYPE, DIAL_MODE };
