/**
 * Console Routes
 * ─────────────────────────────────────────────────────────────────
 * GET    /console/nodes                  — { configured, pending } RS485 node registry
 * POST   /console/nodes/:uniqueId/configure — { name, kind?, zoneId?, soundZoneId?, hasDial?, sensors? } name/set up a node
 * DELETE /console/nodes/:uniqueId        — remove a configured node
 * GET    /console/monitor-zones          — basement/attic read-only zone temps/humidity
 * GET    /console/gpio-map               — { pins, groups } reference pinout map
 * POST   /console/gpio-map               — { pin, label, direction, group, notes? } add/edit a pin
 * DELETE /console/gpio-map/:pin          — remove a pin from the map
 * GET    /console/relay-map              — { relays, boards } reference I2C relay channel map
 * POST   /console/relay-map              — { address, channel, label, notes? } add/edit a relay
 * DELETE /console/relay-map/:address/:channel — remove a relay from the map
 * GET    /console/faults                 — { faults } — same list the fault LED drives off
 * GET    /console/firmware                — [{filename, size, uploadedAt}] uploaded node images
 * POST   /console/firmware                — { filename, dataBase64 } upload/replace a .bin image
 * DELETE /console/firmware/:filename      — remove an uploaded image
 * POST   /console/nodes/:uniqueId/flash   — { filename } push a firmware image to a node over RS485
 * GET    /console/nodes/:uniqueId/flash-status — current/last push progress for a node
 * GET    /console/dial-firmware/latest    — {version, filename} newest uploaded dial-*.bin, or null
 * GET    /console/firmware/:filename/raw  — raw .bin bytes (the dial downloads its own update over WiFi from here — see firmwareUpdate.js's header)
 *
 * Pinned-camera state deliberately has no dedicated route here — it's
 * stored under the existing generic `/settings` key `console`
 * (`{pinnedCameraIds}`), same as every other per-feature settings blob.
 */

const router = require('express').Router();
const nodeRegistry = require('../services/nodeRegistry');
const monitorZones = require('../services/monitorZones');
const gpioMap = require('../services/gpioMap');
const relayMap = require('../services/relayMap');
const faultsSvc = require('../services/faults');
const firmwareSvc = require('../services/firmwareUpdate');

router.get('/console/nodes', (req, res) => {
  res.json(nodeRegistry.getState());
});

router.post('/console/nodes/:uniqueId/configure', async (req, res) => {
  try {
    const { name, kind, zoneId, soundZoneId, hasDial, sensors } = req.body;
    await nodeRegistry.configureNode(req.params.uniqueId, { name, kind, zoneId, soundZoneId, hasDial, sensors });
    res.json({ ok: true, state: nodeRegistry.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/console/nodes/:uniqueId', async (req, res) => {
  try {
    await nodeRegistry.removeNode(req.params.uniqueId);
    res.json({ ok: true, state: nodeRegistry.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/console/monitor-zones', (req, res) => {
  res.json(monitorZones.getState());
});

router.get('/console/gpio-map', (req, res) => {
  res.json(gpioMap.getState());
});

router.post('/console/gpio-map', async (req, res) => {
  try {
    const { pin, label, direction, group, notes } = req.body;
    await gpioMap.upsertPin({ pin: Number(pin), label, direction, group, notes });
    res.json({ ok: true, state: gpioMap.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/console/gpio-map/:pin', async (req, res) => {
  try {
    await gpioMap.removePin(Number(req.params.pin));
    res.json({ ok: true, state: gpioMap.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/console/relay-map', (req, res) => {
  res.json(relayMap.getState());
});

router.post('/console/relay-map', async (req, res) => {
  try {
    const { address, channel, label, notes } = req.body;
    await relayMap.upsertRelay({ address: Number(address), channel: Number(channel), label, notes });
    res.json({ ok: true, state: relayMap.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/console/relay-map/:address/:channel', async (req, res) => {
  try {
    await relayMap.removeRelay(Number(req.params.address), Number(req.params.channel));
    res.json({ ok: true, state: relayMap.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/console/faults', (req, res) => {
  res.json({ faults: faultsSvc.getFaults() });
});

router.get('/console/firmware', (req, res) => {
  res.json(firmwareSvc.listFirmware());
});

// dataBase64 rather than a raw multipart upload — these are at most a few
// hundred KB, well inside the app's existing 50mb JSON body limit, so this
// avoids adding a raw-upload dependency for a rarely-used admin action.
router.post('/console/firmware', (req, res) => {
  try {
    const { filename, dataBase64 } = req.body;
    if (!filename || !dataBase64) throw new Error('filename and dataBase64 are required');
    firmwareSvc.saveFirmware(filename, Buffer.from(dataBase64, 'base64'));
    res.json({ ok: true, firmware: firmwareSvc.listFirmware() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/console/firmware/:filename', (req, res) => {
  try {
    firmwareSvc.deleteFirmware(req.params.filename);
    res.json({ ok: true, firmware: firmwareSvc.listFirmware() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Responds as soon as the push is validated and KICKED OFF, not when it
// finishes (that can take low single digit minutes, see rs485.js's
// flashFirmware()) — startFlash() validates synchronously (bad filename,
// unknown node, already in progress all land here as a normal 400) then
// lets the actual transfer run in the background. The client polls
// flash-status below for progress.
router.post('/console/nodes/:uniqueId/flash', (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) throw new Error('filename is required');
    firmwareSvc.startFlash(req.params.uniqueId, filename);
    res.json({ ok: true, status: firmwareSvc.getFlashStatus(req.params.uniqueId) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/console/nodes/:uniqueId/flash-status', (req, res) => {
  res.json(firmwareSvc.getFlashStatus(req.params.uniqueId));
});

// Unauthenticated on purpose, same as every other route in this file —
// this is what the dial itself calls directly over WiFi/HTTP on the local
// network to check for and pull its own update (see firmwareUpdate.js's
// header and dial_node.ino's checkForOTA()).
router.get('/console/dial-firmware/latest', (req, res) => {
  res.json(firmwareSvc.getLatestDialFirmware());
});

router.get('/console/firmware/:filename/raw', (req, res) => {
  try {
    const buffer = firmwareSvc.readFirmwareFile(req.params.filename);
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

module.exports = router;
