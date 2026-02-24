// In-memory command queue for cellular vehicle (Suburban)
// Device polls GET /device/next, browser waits on POST result

const pendingCmdByDevice = new Map(); // deviceId → { cmdId, cmd, createdAt }
const waitersByCmdId     = new Map(); // cmdId   → { resolve, timeoutHandle }

const AUTH_TOKEN = process.env.ADMIN_UID || 'test';
const TIMEOUT_MS = 35_000;

function newCmdId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (token !== AUTH_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

/**
 * Queue a command for a device and wait for the result.
 * @param {string} deviceId
 * @param {string} cmd        e.g. 'start', 'lock', 'unlock'
 * @returns {Promise<{ok:boolean, message:string, timeout?:boolean}>}
 */
function queueCommand(deviceId, cmd) {
  const cmdId = newCmdId();
  pendingCmdByDevice.set(deviceId, { cmdId, cmd, createdAt: Date.now() });

  return new Promise(resolve => {
    const timeoutHandle = setTimeout(() => {
      waitersByCmdId.delete(cmdId);
      resolve({ ok: false, timeout: true, message: 'Device did not respond in time.' });
    }, TIMEOUT_MS);

    waitersByCmdId.set(cmdId, { resolve, timeoutHandle });
  });
}

function getPendingCommand(deviceId) {
  return pendingCmdByDevice.get(deviceId) ?? null;
}

function resolveCommand(deviceId, cmdId, ok, message) {
  const pending = pendingCmdByDevice.get(deviceId);
  if (pending?.cmdId === cmdId) pendingCmdByDevice.delete(deviceId);

  const waiter = waitersByCmdId.get(cmdId);
  if (waiter) {
    clearTimeout(waiter.timeoutHandle);
    waitersByCmdId.delete(cmdId);
    waiter.resolve({ ok: !!ok, message: message || '' });
  }
}

module.exports = { requireAuth, queueCommand, getPendingCommand, resolveCommand };
