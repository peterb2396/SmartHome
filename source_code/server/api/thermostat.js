/**
 * Thermostat Routes
 * ─────────────────────────────────────────────────────────────────
 * GET  /thermostat                 — full state (zones, mode, rates, last cost decision)
 * POST /thermostat/zone/:id        — { target?, on? } set desired temp and/or on/off
 * POST /thermostat/zone/:id/schedule — { schedule } weekly grid for one zone
 * POST /thermostat/mode            — { mode: 'auto'|'gas'|'electric'|'air' }
 * POST /thermostat/rates           — { gasPricePerTherm?, elecPricePerKwh?, gasAfue? }
 * POST /thermostat/availability    — { source: 'gas'|'electric'|'air', available: boolean }
 *
 * Every mutation responds with the same `state` shape as GET /thermostat
 * (not the raw settings blob) so the frontend can apply it directly as the
 * new source of truth instead of firing a separate GET right after — that
 * extra round-trip was racing with the optimistic update and causing the
 * UI to visibly flicker back to the old value before catching up.
 */

const router = require('express').Router();
const thermostatSvc = require('../services/thermostat');

router.get('/thermostat', (req, res) => {
  res.json(thermostatSvc.getState());
});

router.post('/thermostat/zone/:id', async (req, res) => {
  try {
    const { target, on } = req.body;
    await thermostatSvc.setZone(req.params.id, { target, on });
    res.json({ ok: true, state: thermostatSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/thermostat/zone/:id/schedule', async (req, res) => {
  try {
    const { schedule } = req.body;
    if (!Array.isArray(schedule)) {
      return res.status(400).json({ ok: false, error: 'schedule must be an array' });
    }
    await thermostatSvc.setZoneSchedule(req.params.id, schedule);
    res.json({ ok: true, state: thermostatSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/thermostat/mode', async (req, res) => {
  try {
    await thermostatSvc.setMode(req.body.mode);
    res.json({ ok: true, state: thermostatSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/thermostat/rates', async (req, res) => {
  try {
    await thermostatSvc.setRates(req.body);
    res.json({ ok: true, state: thermostatSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/thermostat/availability', async (req, res) => {
  try {
    const { source, available } = req.body;
    if (typeof available !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'available must be a boolean' });
    }
    await thermostatSvc.setAvailability(source, available);
    res.json({ ok: true, state: thermostatSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
