/**
 * Thermostat Routes
 * ─────────────────────────────────────────────────────────────────
 * GET  /thermostat                 — full 4-zone air-handler state (zones,
 *                                     mode, rates, last cost decision,
 *                                     activeSystem — see below)
 * POST /thermostat/zone/:id        — { target?, on? } set desired temp and/or on/off
 * POST /thermostat/zone/:id/schedule — { schedule } weekly grid for one zone
 * POST /thermostat/zone/:id/balance  — { balancePercent } damper balancing (0-100)
 * POST /thermostat/mode            — { mode: 'auto'|'gas'|'electric'|'air' }
 * POST /thermostat/rates           — { gasPricePerTherm?, elecPricePerKwh?, gasAfue? }
 * POST /thermostat/availability    — { source: 'gas'|'electric'|'air', available: boolean }
 * POST /thermostat/gas-season-threshold — { gasSeasonThresholdF }
 *
 * GET  /thermostat/boiler          — the separate 3-zone gas boiler's state
 *                                     (Great Room / Downstairs / Upstairs —
 *                                     a distinct zone layout, see boiler.js)
 * POST /thermostat/boiler/zone/:id — { target?, on? }
 * POST /thermostat/boiler/zone/:id/schedule — { schedule }
 *
 * `activeSystem` on GET /thermostat ('4zone' | '3zone') tells the frontend
 * which of the two zone layouts is actually live right now — gas mode +
 * cold-enough weather hands control to the boiler's 3 zones; otherwise the
 * air handler's 4 zones are in charge. Both endpoints' data is always
 * available regardless of which is active, so the frontend can render
 * whichever card set applies without a separate "is this system on" check.
 *
 * Every mutation responds with the same `state` shape as its GET route
 * (not the raw settings blob) so the frontend can apply it directly as the
 * new source of truth instead of firing a separate GET right after — that
 * extra round-trip was racing with the optimistic update and causing the
 * UI to visibly flicker back to the old value before catching up.
 */

const router = require('express').Router();
const thermostatSvc = require('../services/thermostat');
const boilerSvc = require('../services/boiler');

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

router.post('/thermostat/zone/:id/balance', async (req, res) => {
  try {
    await thermostatSvc.setZoneBalance(req.params.id, req.body.balancePercent);
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

router.post('/thermostat/gas-season-threshold', async (req, res) => {
  try {
    await thermostatSvc.setGasSeasonThreshold(req.body.gasSeasonThresholdF);
    res.json({ ok: true, state: thermostatSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Gas boiler (separate 3-zone hydronic system — see boiler.js) ───────────
router.get('/thermostat/boiler', (req, res) => {
  res.json(boilerSvc.getState());
});

router.post('/thermostat/boiler/zone/:id', async (req, res) => {
  try {
    const { target, on } = req.body;
    await boilerSvc.setZone(req.params.id, { target, on });
    res.json({ ok: true, state: boilerSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/thermostat/boiler/zone/:id/schedule', async (req, res) => {
  try {
    const { schedule } = req.body;
    if (!Array.isArray(schedule)) {
      return res.status(400).json({ ok: false, error: 'schedule must be an array' });
    }
    await boilerSvc.setZoneSchedule(req.params.id, schedule);
    res.json({ ok: true, state: boilerSvc.getState() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
