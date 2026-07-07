/**
 * Thermostat Routes
 * ─────────────────────────────────────────────────────────────────
 * GET  /thermostat                 — full state (zones, mode, rates, last cost decision)
 * POST /thermostat/zone/:id        — { on?, target? } manual control
 * POST /thermostat/zone/:id/schedule — { schedule } weekly grid for one zone
 * POST /thermostat/mode            — { mode: 'auto'|'gas'|'electric'|'air' }
 * POST /thermostat/rates           — { gasPricePerTherm?, elecPricePerKwh?, gasAfue? }
 */

const router = require('express').Router();
const thermostatSvc = require('../services/thermostat');

router.get('/thermostat', (req, res) => {
  res.json(thermostatSvc.getState());
});

router.post('/thermostat/zone/:id', async (req, res) => {
  try {
    const { on, target } = req.body;
    const settings = await thermostatSvc.setZone(req.params.id, { on, target });
    res.json({ ok: true, settings });
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
    const settings = await thermostatSvc.setZoneSchedule(req.params.id, schedule);
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/thermostat/mode', async (req, res) => {
  try {
    const settings = await thermostatSvc.setMode(req.body.mode);
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/thermostat/rates', async (req, res) => {
  try {
    const settings = await thermostatSvc.setRates(req.body);
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
