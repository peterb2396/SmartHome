/**
 * Firmware Update Service
 * ─────────────────────────────────────────────────────────────────
 * Storage + progress tracking around rs485.js's flashFirmware() — see
 * that file's header for the actual over-the-wire protocol and its safety
 * properties (inactive-partition writes, whole-image CRC32, old firmware
 * stays running on any failure). This module just answers "which .bin
 * files exist" and "how far along is this node's push," for the
 * Console's firmware panel.
 *
 * Images are plain files under FIRMWARE_DIR, uploaded as base64 in a JSON
 * body (reusing the app's existing bodyParser.json({limit:'50mb'})
 * middleware rather than adding a raw-upload dependency for what's at
 * most a few hundred KB file) and named by whoever uploads them — no
 * per-node-type validation happens here; picking the wrong file for a
 * node's hardware is on the person doing the flashing, same as picking
 * the wrong .ino to compile today.
 *
 * The dial (ESP32-S3, dial_node.ino) is the one exception to "server
 * pushes over RS485" — it has no RS485/I2C path back here at all (it's a
 * pure I2C peripheral of its paired RP2040 node), so it pulls its own
 * updates over WiFi/HTTP instead, using getLatestDialFirmware()'s
 * filename-encoded version convention (dial-1.2.3.bin) and the raw-bytes
 * route in console.js. See that file's route list for the exact URLs.
 */

const fs = require('fs');
const path = require('path');
const rs485 = require('./rs485');
const nodeRegistry = require('./nodeRegistry');

const FIRMWARE_DIR = path.join(__dirname, '..', 'firmware');
if (!fs.existsSync(FIRMWARE_DIR)) fs.mkdirSync(FIRMWARE_DIR, { recursive: true });

const FILENAME_RE = /^[\w.-]+\.bin$/; // no path separators — this is the only thing standing between a filename and path.join()

// uniqueId -> { status: 'flashing'|'success'|'failed', sent, total, filename, startedAt, finishedAt, error }
const flashStatus = new Map();

function listFirmware() {
  return fs.readdirSync(FIRMWARE_DIR)
    .filter(f => FILENAME_RE.test(f))
    .map(f => {
      const stat = fs.statSync(path.join(FIRMWARE_DIR, f));
      return { filename: f, size: stat.size, uploadedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

function saveFirmware(filename, buffer) {
  if (!FILENAME_RE.test(filename)) throw new Error('Firmware filename must be a plain name ending in .bin (letters/numbers/._- only)');
  fs.writeFileSync(path.join(FIRMWARE_DIR, filename), buffer);
}

function deleteFirmware(filename) {
  if (!FILENAME_RE.test(filename)) throw new Error('Invalid firmware filename');
  const filePath = path.join(FIRMWARE_DIR, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function getFlashStatus(uniqueId) {
  return flashStatus.get(uniqueId) || null;
}

function readFirmwareFile(filename) {
  if (!FILENAME_RE.test(filename)) throw new Error('Invalid firmware filename');
  const filePath = path.join(FIRMWARE_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`No firmware file named ${filename}`);
  return fs.readFileSync(filePath);
}

// The dial (ESP32-S3, server/rs485-nodes/dial_node.ino) has no RS485/I2C
// path back to this server — it's a pure I2C peripheral of its paired
// RP2040 node — so it can't be pushed to via rs485.js's flashFirmware()
// the way the RP2040 nodes are. It has real WiFi hardware on-chip though
// (every ESP32-S3 does), so it pulls its own updates over plain HTTP
// instead: it GETs /console/dial-firmware/latest, compares the version
// against its own embedded FIRMWARE_VERSION, and if newer, downloads the
// .bin directly via /console/firmware/:filename/raw. Version is encoded
// in the filename by convention (dial-1.2.3.bin) rather than a separate
// metadata store — keeps this a plain drop-a-file system, same as the
// RP2040 images, with nothing extra to keep in sync.
const DIAL_FILENAME_RE = /^dial-(\d+)\.(\d+)\.(\d+)\.bin$/;

function getLatestDialFirmware() {
  const candidates = fs.readdirSync(FIRMWARE_DIR)
    .map(f => ({ filename: f, match: f.match(DIAL_FILENAME_RE) }))
    .filter(c => c.match)
    .map(c => ({
      filename: c.filename,
      version: `${c.match[1]}.${c.match[2]}.${c.match[3]}`,
      versionParts: [Number(c.match[1]), Number(c.match[2]), Number(c.match[3])],
    }));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    for (let i = 0; i < 3; i++) if (a.versionParts[i] !== b.versionParts[i]) return b.versionParts[i] - a.versionParts[i];
    return 0;
  });
  return { filename: candidates[0].filename, version: candidates[0].version };
}

// Validates and kicks off a push SYNCHRONOUSLY (so a bad filename/unknown
// node/already-in-progress call throws straight back to the route handler
// as a normal 400, not silently into a background promise the caller never
// sees) — the actual multi-minute RS485 transfer runs detached afterward;
// callers poll getFlashStatus(uniqueId) for its progress.
function startFlash(uniqueId, filename) {
  if (!FILENAME_RE.test(filename)) throw new Error('Invalid firmware filename');
  const filePath = path.join(FIRMWARE_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`No firmware file named ${filename}`);

  const node = nodeRegistry.getState().configured.find(n => n.uniqueId === uniqueId);
  if (!node) throw new Error('Node not found in registry');
  if (node.busAddress == null) throw new Error('Node has no bus address assigned');

  const existing = flashStatus.get(uniqueId);
  if (existing && existing.status === 'flashing') throw new Error('A flash is already in progress for this node');

  const buffer = fs.readFileSync(filePath);
  flashStatus.set(uniqueId, {
    status: 'flashing', sent: 0, total: buffer.length, filename,
    startedAt: new Date().toISOString(), finishedAt: null, error: null,
  });

  runFlash(uniqueId, node.busAddress, buffer);
}

async function runFlash(uniqueId, busAddress, buffer) {
  try {
    const ok = await rs485.flashFirmware(busAddress, buffer, ({ sent, total }) => {
      const current = flashStatus.get(uniqueId);
      if (current) flashStatus.set(uniqueId, { ...current, sent, total });
    });
    const current = flashStatus.get(uniqueId);
    flashStatus.set(uniqueId, {
      ...current,
      status: ok ? 'success' : 'failed',
      finishedAt: new Date().toISOString(),
      error: ok ? null : 'No response, CRC mismatch, or rejected mid-transfer — the node is still running its previous firmware untouched.',
    });
  } catch (err) {
    const current = flashStatus.get(uniqueId);
    flashStatus.set(uniqueId, { ...current, status: 'failed', finishedAt: new Date().toISOString(), error: err.message });
  }
}

module.exports = { listFirmware, saveFirmware, deleteFirmware, getFlashStatus, startFlash, readFirmwareFile, getLatestDialFirmware };
