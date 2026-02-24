/**
 * Vehicle Routes (Cellular Car Control)
 * ─────────────────────────────────────────────────────────────────
 * Browser → server → vehicle (cellular polling)
 *
 * POST /car/start           Queue a remote start
 * POST /car/lock            Queue a lock command
 * POST /car/unlock          Queue an unlock command
 * GET  /device/next         Device polls for next pending command
 * POST /device/result       Device posts back its result
 */

const router       = require('express').Router();
const vehicleQueue = require('../services/vehicleQueue');
const lightsSvc    = require('../services/lights');

// ── Browser-facing commands ─────────────────────────────────────────────────────

async function handleCarCommand(req, res, cmd) {
  const { password } = req.body;
  const headerToken  = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  const authorized =
    password    === process.env.ADMIN_UID ||
    headerToken === process.env.ADMIN_UID ||
    await lightsSvc.validatePassword(password);

  if (!authorized) return res.status(403).json({ ok: false, error: 'Forbidden' });

  const result = await vehicleQueue.queueCommand('SUBURBAN', cmd);
  res.json(result);
}

router.post('/car/start',  (req, res) => handleCarCommand(req, res, 'start'));
router.post('/car/lock',   (req, res) => handleCarCommand(req, res, 'lock'));
router.post('/car/unlock', (req, res) => handleCarCommand(req, res, 'unlock'));

// Legacy routes kept for backwards compatibility
router.post('/start-car',  (req, res) => handleCarCommand(req, res, 'start'));
router.post('/lock-car',   (req, res) => handleCarCommand(req, res, 'lock'));
router.post('/unlock-car', (req, res) => handleCarCommand(req, res, 'unlock'));

// ── Device (Suburban) polling endpoints ─────────────────────────────────────────

/** GET /device/next?deviceId=SUBURBAN — device asks for its next command */
router.get('/device/next', vehicleQueue.requireAuth, (req, res) => {
  const deviceId = String(req.query.deviceId || '');
  if (!deviceId) return res.status(400).json({ cmd: null, error: 'Missing deviceId' });

  const pending = vehicleQueue.getPendingCommand(deviceId);
  if (!pending) return res.json({ cmd: null });

  res.json({ cmd: pending.cmd, cmdId: pending.cmdId });
});

/** POST /device/result — device reports outcome of a command */
router.post('/device/result', vehicleQueue.requireAuth, (req, res) => {
  const { deviceId, cmdId, ok, message } = req.body || {};
  if (!deviceId || !cmdId) {
    return res.status(400).json({ ok: false, error: 'Missing deviceId or cmdId' });
  }
  vehicleQueue.resolveCommand(deviceId, cmdId, ok, message);
  res.json({ ok: true });
});

module.exports = router;
