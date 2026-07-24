/**
 * Console Routes
 * ─────────────────────────────────────────────────────────────────
 * GET    /console/nodes                  — { configured, pending } RS485 node registry
 * POST   /console/nodes/:uniqueId/configure — { name, kind?, zoneId?, sensors? } name/set up a node
 * DELETE /console/nodes/:uniqueId        — remove a configured node
 * GET    /console/monitor-zones          — basement/attic read-only zone temps/humidity
 * GET    /console/gpio-map               — { pins, groups } reference pinout map
 * POST   /console/gpio-map               — { pin, label, direction, group, notes? } add/edit a pin
 * DELETE /console/gpio-map/:pin          — remove a pin from the map
 * GET    /console/faults                 — { faults } — same list the fault LED drives off
 *
 * Pinned-camera state deliberately has no dedicated route here — it's
 * stored under the existing generic `/settings` key `console`
 * (`{pinnedCameraIds}`), same as every other per-feature settings blob.
 */

const router = require('express').Router();
const nodeRegistry = require('../services/nodeRegistry');
const monitorZones = require('../services/monitorZones');
const gpioMap = require('../services/gpioMap');
const faultsSvc = require('../services/faults');

router.get('/console/nodes', (req, res) => {
  res.json(nodeRegistry.getState());
});

router.post('/console/nodes/:uniqueId/configure', async (req, res) => {
  try {
    const { name, kind, zoneId, sensors } = req.body;
    await nodeRegistry.configureNode(req.params.uniqueId, { name, kind, zoneId, sensors });
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

router.get('/console/faults', (req, res) => {
  res.json({ faults: faultsSvc.getFaults() });
});

module.exports = router;
