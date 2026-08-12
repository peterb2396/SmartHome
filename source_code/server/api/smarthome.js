/**
 * Smart Home Routes
 * ─────────────────────────────────────────────────────────────────
 * Lights          POST /lights
 * Devices         GET  /list-devices
 *
 * Sensors         GET  /sensors             — all sensors at once
 *                 GET  /sensors/:name       — one sensor by name
 *                 POST /sensors/:name       — any device posts a reading
 *
 * Plugs (legacy)  POST /power
 * Webhooks        POST /smartthings-webhook
 * Log             POST /log
 *
 * ─────────────────────────────────────────────────────────────────
 * HOW SENSORS FLOW IN:
 *
 *   Raspberry Pi GPIO (direct wiring)
 *     → gpio.js watches pin, calls sensors.set(name, value)
 *     → readable via GET /sensors/:name immediately on change
 *
 *   RS485 nodes (rs485.js polls each configured node over the bus)
 *     → sensors.set(`${type}-${zoneId}`, value, unit)
 *     → readable via GET /sensors/:name
 *
 *   Any other device
 *     → POST /sensors/:name  { value, unit?, metadata?, auth }
 *     → stored in same store
 */

const router      = require('express').Router();
const settingsSvc = require('../services/settings');
const smartthings = require('../services/smartthings');
const smartthingsLifecycle = require('../services/smartthingsLifecycle');
const lightsSvc   = require('../services/lights');
const tuya        = require('../services/tuya');
const sensors     = require('../services/sensorStore');

// ── Auth helper for sensor/device endpoints ──────────────────────────────────
function isSensorAuthorized(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || req.body?.auth;
  return token === process.env.ADMIN_UID || token === process.env.SENSOR_TOKEN;
}

// ── Lights ───────────────────────────────────────────────────────────────────

router.get('/list-devices', async (req, res) => {
  try {
    res.json(await smartthings.listDevices());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lights', async (req, res) => {
  const { devices, on, password, level } = req.body;
  try {
    await lightsSvc.lights(devices, on, password, level);
    res.json({ success: true });
  } catch (err) {
    console.error('[/lights]', err);
    res.status(500).json({ error: 'Failed to control lights' });
  }
});

// ── Generic sensor endpoints ─────────────────────────────────────────────────

/**
 * GET /sensors
 * Returns all sensor readings at once — Pi GPIO and RS485 nodes combined.
 */
router.get('/sensors', (req, res) => {
  res.json(sensors.getAll());
});

/**
 * GET /sensors/:name
 * Returns the latest reading for a single named sensor.
 * Examples: /sensors/temp-office  /sensors/humidity-office
 */
router.get('/sensors/:name', (req, res) => {
  const state = sensors.get(req.params.name);
  if (!state) {
    return res.status(404).json({ error: `No data for sensor "${req.params.name}"` });
  }
  res.json(state);
});

/**
 * POST /sensors/:name
 * Any device (not just ESP32) can push a single sensor reading.
 * Body: { value, unit?, metadata?, auth }
 * Auth: Bearer token or auth field must match ADMIN_UID or SENSOR_TOKEN
 */
router.post('/sensors/:name', (req, res) => {
  if (!isSensorAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const { value, unit, metadata } = req.body;
  const name = req.params.name;

  sensors.set(name, value, unit ?? null, metadata ?? {});
  console.log(`[Sensor] ${name} = ${value}${unit ? ' ' + unit : ''}`);

  res.json({ ok: true, sensor: name, ...sensors.get(name) });
});

// ── Tuya smart plugs (legacy) ────────────────────────────────────────────────

router.post('/power', tuya.tokenMiddleware, async (req, res) => {
  const { password, deviceId, on } = req.body;
  if (!await lightsSvc.validatePassword(password)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await tuya.powerPlug(deviceId, on);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[/power]', err);
    res.status(500).json({ error: 'Failed to control device' });
  }
});

// ── SmartThings webhook ──────────────────────────────────────────────────────
// "SmartHomeNode" is registered in the SmartThings developer workspace as a
// Webhook-hosted app, not a browser-redirect OAuth app — SmartThings calls
// this URL directly with lifecycle events (PING/CONFIRMATION/INSTALL/
// UPDATE/UNINSTALL), and INSTALL/UPDATE is what actually delivers a fresh
// access/refresh token pair. See services/smartthingsLifecycle.js for the
// real handler (an earlier version of this route was a bare stub, and this
// codebase briefly had a separate browser-redirect OAuth flow built against
// the wrong integration model — both replaced by this).

router.post('/smartthings-webhook', (req, res) => {
  smartthingsLifecycle.handleWebhook(req, res);
});

// ── Remote log (from ESP32 / other devices) ──────────────────────────────────

router.post('/log', (req, res) => {
  const { src, pwd, log } = req.body;
  if (!pwd || pwd !== process.env.SMART_CLIENT_ID || !src || !log) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }
  console.log(`[${src}] ${log}`);
  res.json({ status: 'ok' });
});

module.exports = router;
