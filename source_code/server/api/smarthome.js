/**
 * Smart Home Routes
 * ─────────────────────────────────────────────────────────────────
 * Lights          POST /lights
 * Devices         GET  /list-devices
 *
 * Garage          POST /garage/trigger      — pulse relay to open/close
 *                 GET  /garage/status       — reed switch open/closed
 *
 * Sensors         GET  /sensors             — all sensors at once
 *                 GET  /sensors/:name       — one sensor by name
 *                 POST /sensors/:name       — any device posts a reading
 *
 * ESP32 batch     POST /esp32/report        — attic node batch report
 *                 GET  /esp32/status        — all sensor snapshot
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
 *   ESP32 over WiFi
 *     → POST /esp32/report  { sensors: { "temp-attic": { value, unit } } }
 *     → calls sensors.setBulk(), stored in same store
 *     → readable via GET /sensors/:name
 *
 *   Any other device
 *     → POST /sensors/:name  { value, unit?, metadata?, auth }
 *     → stored in same store
 */

const router      = require('express').Router();
const settingsSvc = require('../services/settings');
const smartthings = require('../services/smartthings');
const lightsSvc   = require('../services/lights');
const tuya        = require('../services/tuya');
const gpioDrv     = require('../services/gpio');
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

// ── Garage door ──────────────────────────────────────────────────────────────

/**
 * GET /garage/status
 * Returns the current reed switch state: { value: "open"|"closed", updatedAt }
 * This is populated automatically by gpio.js whenever the pin changes.
 */
router.get('/garage/status', (req, res) => {
  const state = sensors.get('garage');
  if (!state) return res.json({ value: 'unknown', updatedAt: null });
  res.json(state);
});

/**
 * POST /garage/trigger
 * Body: { password, duration? }
 * Pulses the relay wired to the garage door opener.
 * The door will open if closed, or close if open (same as pressing the button).
 */
router.post('/garage/trigger', async (req, res) => {
  const { password, duration } = req.body;
  if (!await lightsSvc.validatePassword(password)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  try {
    const result = await gpioDrv.triggerGarageDoor(duration ?? 500);
    res.json(result);
  } catch (err) {
    console.error('[/garage/trigger]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Generic sensor endpoints ─────────────────────────────────────────────────

/**
 * GET /sensors
 * Returns all sensor readings at once — Pi GPIO and ESP32 combined.
 */
router.get('/sensors', (req, res) => {
  res.json(sensors.getAll());
});

/**
 * GET /sensors/:name
 * Returns the latest reading for a single named sensor.
 * Examples: /sensors/garage  /sensors/temp-attic  /sensors/window-front
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

// ── ESP32 attic node ─────────────────────────────────────────────────────────

/**
 * POST /esp32/report
 * The ESP32 calls this every N seconds to batch-report all its sensors.
 *
 * Body:
 * {
 *   auth: "SENSOR_TOKEN",
 *   sensors: {
 *     "temp-attic":     { value: 72.1, unit: "F", metadata: { location: "attic" } },
 *     "humidity-attic": { value: 54,   unit: "%"  },
 *     "window-north":   { value: "open" },
 *     "window-east":    { value: "closed" }
 *   }
 * }
 *
 * All values land in the same sensorStore as Pi GPIO readings.
 * Read them back with GET /sensors/<name> or GET /sensors.
 */
router.post('/esp32/report', (req, res) => {
  if (!isSensorAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const { sensors: payload } = req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing sensors object' });
  }

  sensors.setBulk(payload);

  const names = Object.keys(payload);
  console.log(`[ESP32] Received ${names.length} sensor(s): ${names.join(', ')}`);

  res.json({ ok: true, received: names.length, timestamp: new Date().toISOString() });
});

/**
 * GET /esp32/status
 * Convenience alias — returns everything in the sensor store.
 */
router.get('/esp32/status', (req, res) => {
  res.json({ sensors: sensors.getAll(), timestamp: new Date().toISOString() });
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

router.post('/smartthings-webhook', (req, res) => {
  console.log('[SmartThings Webhook]', JSON.stringify(req.body));
  res.sendStatus(200);
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
