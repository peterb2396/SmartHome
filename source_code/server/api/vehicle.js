/**
 * Vehicle Routes (Cellular Car Control)
 * ─────────────────────────────────────────────────────────────────
 * POST /car/start           Queue a remote start
 * POST /car/lock            Queue a lock command
 * POST /car/unlock          Queue an unlock command
 *
 * GET  /device/next         Device polls for next pending command.
 *                           Accepts ?wait=1 for long-poll (recommended).
 *                           Accepts ?carOn=1|0 — ESP32 reports ignition
 *                           state on every poll. Stored in sensorStore
 *                           as "vehicle-suburban".
 *
 * POST /device/result       Device posts back its result.
 *                           Accepts { carOn: true|false } in body —
 *                           also updates vehicle-suburban sensor.
 *
 * GET  /car/status          Returns latest known car state from sensorStore.
 */

const router       = require('express').Router();
const vehicleQueue = require('../services/vehicleQueue');
const lightsSvc    = require('../services/lights');
const sensors      = require('../services/sensorStore');
const { sendPush } = require('../services/mail');

// ── Auth helper ───────────────────────────────────────────────────────────────
async function handleCarCommand(req, res, cmd) {
  const { password } = req.body;
  const headerToken  = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  const authorized =
    password    === process.env.ADMIN_UID ||
    headerToken === process.env.ADMIN_UID ||
    await lightsSvc.validatePassword(password);

  if (!authorized) return res.status(403).json({ ok: false, error: 'Forbidden' });

  // Send push notification
  sendPush(`Car command: ${cmd}`, 'Suburban');

  const result = await vehicleQueue.queueCommand('SUBURBAN', cmd);
  res.json(result);
}

// ── Browser-facing commands ───────────────────────────────────────────────────
router.post('/car/start',  (req, res) => handleCarCommand(req, res, 'start'));
router.post('/car/lock',   (req, res) => handleCarCommand(req, res, 'lock'));
router.post('/car/unlock', (req, res) => handleCarCommand(req, res, 'unlock'));

// Legacy routes
router.post('/start-car',  (req, res) => handleCarCommand(req, res, 'start'));
router.post('/lock-car',   (req, res) => handleCarCommand(req, res, 'lock'));
router.post('/unlock-car', (req, res) => handleCarCommand(req, res, 'unlock'));

// ── Current car status (for frontend polling) ─────────────────────────────────
router.get('/car/status', (req, res) => {
  const s = sensors.get('vehicle-suburban');
  res.json(s ?? { value: 'unknown', updatedAt: null });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse and store carOn status whenever the ESP32 reports it.
 * carOn can arrive as query param (GET) or body field (POST).
 * Stores as sensor "vehicle-suburban" with value "on" or "off".
 */
function recordCarStatus(carOnRaw) {
  if (carOnRaw === undefined || carOnRaw === null || carOnRaw === '') return;
  // Accept: "1", "true", 1, true  →  "on"
  //         "0", "false", 0, false → "off"
  const isOn = carOnRaw === '1' || carOnRaw === 1 || carOnRaw === true || carOnRaw === 'true';
  sensors.set('vehicle-suburban', isOn ? 'on' : 'off', null, {
    location: 'Suburban',
    source:   'esp32-cellular',
  });
}

// ── Device polling ────────────────────────────────────────────────────────────
/**
 * GET /device/next?deviceId=SUBURBAN[&wait=1][&carOn=0|1]
 *
 * Short-poll (wait omitted): returns immediately.
 * Long-poll  (wait=1):       holds connection up to 25s, responds the
 *                            instant a command is queued.
 *
 * carOn query param: ESP32 sends its ignition pin state on every poll.
 * The server stores it in sensorStore so the frontend can display it.
 */
router.get('/device/next', vehicleQueue.requireAuth, async (req, res) => {
  const deviceId = String(req.query.deviceId || '');
  if (!deviceId) return res.status(400).json({ cmd: null, error: 'Missing deviceId' });

  // Record ignition state if provided
  recordCarStatus(req.query.carOn);

  const useLongPoll = req.query.wait === '1';

  if (useLongPoll) {
    const result = await vehicleQueue.waitForCommand(deviceId);
    if (result) {
      return res.json({ cmd: result.cmd, cmdId: result.cmdId });
    }
    return res.json({ cmd: null });
  }

  // Short-poll
  const pending = vehicleQueue.getPendingCommand(deviceId);
  if (pending) {
    return res.json({ cmd: pending.cmd, cmdId: pending.cmdId });
  }
  res.json({ cmd: null });
});

// ── Device result ─────────────────────────────────────────────────────────────
/**
 * POST /device/result
 * Body: { deviceId, cmdId, ok, message, carOn? }
 *
 * carOn is optional — lets the ESP32 report ignition state at result time too.
 */
router.post('/device/result', vehicleQueue.requireAuth, (req, res) => {
  const { deviceId, cmdId, ok, message, carOn } = req.body || {};
  if (!deviceId || !cmdId) {
    return res.status(400).json({ ok: false, error: 'Missing deviceId or cmdId' });
  }

  // Record ignition state if provided
  recordCarStatus(carOn);

  vehicleQueue.resolveCommand(deviceId, cmdId, ok, message);
  res.json({ ok: true });
});

module.exports = router;
