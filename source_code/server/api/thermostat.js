/**
 * Thermostat Routes
 * ─────────────────────────────────────────────────────────────────
 * GET  /thermostat                 — full 4-zone air-handler state (zones,
 *                                     mode, rates, last cost decision,
 *                                     activeSystem — see below)
 * POST /thermostat/zone/:id        — { target?, on? } set desired temp and/or on/off
 * POST /thermostat/zone/:id/schedule — { schedule } weekly grid for one zone
 * POST /thermostat/zone/:id/balance  — { balancePercent, password } damper balancing
 *                                     (0-100) — restricted to pete.buo@gmail.com only,
 *                                     see isAuthorizedForDamperBalance() below
 * POST /thermostat/mode            — { mode: 'auto'|'gas'|'electric'|'air' }
 * POST /thermostat/rates           — { gasPricePerTherm?, elecPricePerKwh?, gasAfue? }
 * POST /thermostat/availability    — { source: 'gas'|'electric'|'air', available: boolean }
 *
 * GET  /thermostat/boiler          — the separate gas boiler's state — a
 *                                     distinct hydronic plant, but as of a
 *                                     real re-piping of its plumbing it now
 *                                     serves the exact same 4 zones as GET
 *                                     /thermostat (Primary Suite / Upstairs /
 *                                     Downstairs / Office, matching ids —
 *                                     see boiler.js)
 * POST /thermostat/boiler/zone/:id — { target?, on? }
 * POST /thermostat/boiler/zone/:id/schedule — { schedule }
 *
 * `activeSystem` on GET /thermostat ('4zone' | '3zone') tells the frontend
 * which of the two PLANTS is actually live right now — an immediate,
 * unconditional read of `mode`: gas mode means the boiler, full stop, no
 * seasonal prediction or lookahead. Both endpoints' data is always
 * available regardless of which is active, so the frontend can render
 * whichever card set applies without a separate "is this system on" check.
 * ('3zone'/'4zone' are historical internal token names, kept as-is now that
 * both plants serve 4 zones — see thermostat.js's own header/
 * getActiveSystem() comment for why.)
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
const User = require('../db/userModel');

// The damper balance slider physically retunes airflow between zones —
// worth locking to one person rather than the household-wide PASSWORD
// secret every other privileged route accepts (see lightsSvc.validatePassword),
// since a mis-set balance is easy to not notice and annoying for everyone
// else to live with. `password` here is the same value the frontend
// already stores as "token" post-login (see web/src/api/index.js) — it's
// actually the user's Mongo _id, not a real password; same convention as
// every other auth check in this codebase, just resolved one step further
// to the account's email instead of stopping at "any valid user."
const DAMPER_BALANCE_ALLOWED_EMAIL = 'pete.buo@gmail.com';
async function isAuthorizedForDamperBalance(password) {
  if (!password) return false;
  try {
    const user = await User.findById(password);
    return user?.email?.toLowerCase() === DAMPER_BALANCE_ALLOWED_EMAIL;
  } catch {
    return false; // password wasn't a valid ObjectId, or lookup failed
  }
}

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
  if (!await isAuthorizedForDamperBalance(req.body.password)) {
    return res.status(403).json({ ok: false, error: 'Only pete.buo@gmail.com can change damper balance.' });
  }
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

// ── Gas boiler (separate hydronic system, same 4 zones — see boiler.js) ────
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
