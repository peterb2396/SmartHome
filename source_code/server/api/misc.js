/**
 * Misc Routes
 * ─────────────────────────────────────────────────────────────────
 * GET  /              App name
 * GET  /ping          Heartbeat
 * GET  /cb            SmartThings OAuth callback
 * GET  /users         List users
 * GET  /settings      Get settings (tokens stripped)
 * POST /settings      Update a setting
 * POST /sendMail      Send email via API
 */

const router      = require('express').Router();
const User        = require('../db/userModel');
const settingsSvc = require('../services/settings');
const { sendMail } = require('../services/mail');

router.get('/', (req, res) => res.send(process.env.APP_NAME));

router.get('/ping', (req, res) => res.json(Date.now()));

router.get('/cb', (req, res) => {
  console.log('[OAuth] Callback hit');
  res.json('callback hit');
});

// ── Users ────────────────────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, { _id: 1, email: 1 }).lean();
    res.json(users.map(u => ({
      id:   u._id.toString(),
      name: u.email.substring(0, u.email.indexOf('@')),
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  const { accessToken, refreshToken, $isNew, $__, _doc, ...safe } = settingsSvc.get();
  res.json(safe);
});

router.post('/settings', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key is required' });
  try {
    const updated = await settingsSvc.updateSetting(key, value);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mail ──────────────────────────────────────────────────────────────────────────

router.post('/sendMail', async (req, res) => {
  const { from, to, subject, text, password } = req.body;
  if (!from || !to || !subject || !text || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const ok = await sendMail(from, to, subject, text, password);
  ok
    ? res.json({ success: true })
    : res.status(500).json({ error: 'Failed to send email' });
});

module.exports = router;
