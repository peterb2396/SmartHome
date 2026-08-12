/**
 * Lutron Routes
 * ─────────────────────────────────────────────────────────────────
 * GET    /lutron/devices              — registry + live on/off/level state
 * POST   /lutron/devices              — { integrationId, name, type, room?, owner? } add/edit a device
 * DELETE /lutron/devices/:integrationId
 * POST   /lutron/devices/:integrationId/control — { on, level? }
 *
 * See services/lutron.js — this is the local, cloud-free replacement for
 * SmartThings-mediated light/fan control (all switches are Lutron Caseta).
 */

const router = require('express').Router();
const lutron = require('../services/lutron');

router.get('/lutron/devices', (req, res) => {
  res.json(lutron.getState());
});

router.post('/lutron/devices', async (req, res) => {
  try {
    const { integrationId, name, type, room, owner } = req.body;
    await lutron.upsertDevice({ integrationId, name, type, room, owner });
    res.json({ ok: true, state: lutron.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/lutron/devices/:integrationId', async (req, res) => {
  try {
    await lutron.removeDevice(req.params.integrationId);
    res.json({ ok: true, state: lutron.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/lutron/devices/:integrationId/control', async (req, res) => {
  try {
    const { on, level } = req.body;
    const state = await lutron.setDevice(Number(req.params.integrationId), { on, level });
    res.json({ ok: true, state });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
