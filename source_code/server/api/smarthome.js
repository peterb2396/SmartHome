/**
 * Smart Home Routes
 * ─────────────────────────────────────────────────────────────────
 * Lights          POST /lights
 * Devices         GET  /list-devices
 * Garage          POST /garage/trigger
 *                 GET  /garage/status
 * Window sensors  POST /sensors/window
 *                 GET  /sensors/window
 * Temp sensors    POST /sensors/temperature
 *                 GET  /sensors/temperature
 * Generic sensor  POST /sensors/:name
 *                 GET  /sensors/:name
 * Plugs (Tuya)   POST /power   (legacy, deprecated)
 * Webhooks        POST /smartthings-webhook
 * Log             POST /log
 */

const router      = require('express').Router();
const settingsSvc = require('../services/settings');
const smartthings = require('../services/smartthings');
const lightsSvc   = require('../services/lights');
const tuya        = require('../services/tuya');
const gpioDrv     = require('../services/gpio');

// ── In-memory sensor store (augment with DB persistence if needed) ──────────────
// Format: { [name]: { value, unit, updatedAt, metadata } }
const sensorData = {};

// ── Lights ──────────────────────────────────────────────────────────────────────

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

// ── Garage door ─────────────────────────────────────────────────────────────────

/**
 * POST /garage/trigger
 * Body: { password, duration? }
 * Pulses the relay to open/close the garage door.
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

/**
 * GET /garage/status
 * Returns the last known garage door sensor state (open/closed).
 * Populated by the ESP32 sensor report endpoint.
 */
router.get('/garage/status', (req, res) => {
  res.json(sensorData['garage'] ?? { value: 'unknown', updatedAt: null });
});

// ── Generic sensor store (used by ESP32 + any peripheral) ───────────────────────

/**
 * POST /sensors/:name
 * Body: { value, unit?, metadata?, auth }
 * ESP32 or any sensor device calls this to report its latest reading.
 *
 * Examples:
 *   POST /sensors/temperature   { value: 68.5, unit: "F", metadata: { location: "attic" }, auth: "TOKEN" }
 *   POST /sensors/window-north  { value: "open",  auth: "TOKEN" }
 *   POST /sensors/garage        { value: "open",  auth: "TOKEN" }
 */
router.post('/sensors/:name', (req, res) => {
  const { value, unit, metadata, auth } = req.body;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || auth;

  if (token !== process.env.ADMIN_UID && token !== process.env.SENSOR_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const name = req.params.name;
  sensorData[name] = {
    value,
    unit: unit ?? null,
    metadata: metadata ?? {},
    updatedAt: new Date().toISOString(),
  };

  console.log(`[Sensor] ${name} = ${value}${unit ? ' ' + unit : ''}`);
  res.json({ ok: true, sensor: name, ...sensorData[name] });
});

/**
 * GET /sensors/:name
 * Returns the latest reading for a named sensor.
 */
router.get('/sensors/:name', (req, res) => {
  const name = req.params.name;
  if (!sensorData[name]) {
    return res.status(404).json({ ok: false, error: `No data for sensor "${name}"` });
  }
  res.json(sensorData[name]);
});

/**
 * GET /sensors
 * Returns all sensor readings at once.
 */
router.get('/sensors', (req, res) => {
  res.json(sensorData);
});

// ── Typed sensor aliases for convenience ────────────────────────────────────────

/**
 * GET  /sensors/temperature — returns all sensors whose name starts with "temperature" or "temp"
 * This is just a filtered view of the generic store.
 */
router.get('/sensors/temperature/all', (req, res) => {
  const temps = Object.fromEntries(
    Object.entries(sensorData).filter(([k]) => k.startsWith('temp'))
  );
  res.json(temps);
});

router.get('/sensors/window/all', (req, res) => {
  const windows = Object.fromEntries(
    Object.entries(sensorData).filter(([k]) => k.startsWith('window'))
  );
  res.json(windows);
});

// ── ESP32 attic node ────────────────────────────────────────────────────────────
// The ESP32 in the attic can batch-report multiple sensor values in one call.

/**
 * POST /esp32/report
 * Body: { auth: "TOKEN", sensors: { "temp-attic": { value: 72, unit: "F" }, "humidity-attic": { value: 55, unit: "%" }, ... } }
 *
 * Arduino/ESP32 sketch sends a JSON POST every N seconds.
 * Authorization: use the SENSOR_TOKEN or ADMIN_UID env var as the auth field or Bearer header.
 */
router.post('/esp32/report', (req, res) => {
  const { sensors, auth } = req.body;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || auth;

  if (token !== process.env.ADMIN_UID && token !== process.env.SENSOR_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  if (!sensors || typeof sensors !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing sensors object' });
  }

  const now = new Date().toISOString();
  for (const [name, reading] of Object.entries(sensors)) {
    sensorData[name] = {
      value:     reading.value,
      unit:      reading.unit ?? null,
      metadata:  reading.metadata ?? {},
      updatedAt: now,
    };
    console.log(`[ESP32] ${name} = ${reading.value}${reading.unit ? ' ' + reading.unit : ''}`);
  }

  res.json({ ok: true, received: Object.keys(sensors).length, timestamp: now });
});

/**
 * GET /esp32/status
 * Returns all sensor data tagged as coming from the ESP32 (prefix "esp32-" or any sensor).
 * Useful as a quick health dashboard.
 */
router.get('/esp32/status', (req, res) => {
  res.json({ sensors: sensorData, timestamp: new Date().toISOString() });
});

// ── Tuya smart plugs (legacy endpoint kept for compatibility) ────────────────────

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

// ── SmartThings webhook ──────────────────────────────────────────────────────────

router.post('/smartthings-webhook', (req, res) => {
  console.log('[SmartThings Webhook]', JSON.stringify(req.body));
  res.sendStatus(200);
});

// ── Remote logging (from ESP32 / other devices) ──────────────────────────────────

router.post('/log', (req, res) => {
  const { src, pwd, log } = req.body;
  if (!pwd || pwd !== process.env.SMART_CLIENT_ID || !src || !log) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }
  console.log(`[${src}] ${log}`);
  res.json({ status: 'ok' });
});

module.exports = router;
