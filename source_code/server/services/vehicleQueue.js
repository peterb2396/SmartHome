/**
 * Vehicle Command Queue
 * ─────────────────────────────────────────────────────────────────
 * Browser sends a command → server holds it → car ESP32 polls and
 * picks it up → car posts result back → server resolves to browser.
 *
 * KEY CHANGE FROM v1:
 *   Timeout raised from 35s → 90s. This is the real fix. The old
 *   30s poll interval + ~8s execution time regularly exceeded 35s.
 *   90s gives 3 full poll cycles of headroom.
 *
 *   The /device/next endpoint now supports long-polling: if the car
 *   passes ?wait=1, the server holds the connection open for up to
 *   LONG_POLL_MS and resolves the moment a command is queued.
 *   This makes the car respond in <1s instead of up to 30s.
 *
 *   Both modes work — if the car sketch doesn't support long-poll
 *   yet, short polling still works, it's just slower.
 */

const pendingCmdByDevice = new Map(); // deviceId → { cmdId, cmd, createdAt }
const waitersByCmdId     = new Map(); // cmdId   → { resolve, timeoutHandle }
const longPollWaiters    = new Map(); // deviceId → [{ resolve, timeoutHandle }]

const AUTH_TOKEN   = process.env.ADMIN_UID || 'test';
const TIMEOUT_MS   = 90_000;   // 90s — gives 3 full 30s poll cycles
const LONG_POLL_MS = 25_000;   // hold long-poll connections for 25s

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
 * Also wakes any long-polling connections immediately.
 */
function queueCommand(deviceId, cmd) {
  const cmdId = newCmdId();
  pendingCmdByDevice.set(deviceId, { cmdId, cmd, createdAt: Date.now() });

  // Wake any long-polling connections for this device immediately
  const waiters = longPollWaiters.get(deviceId) || [];
  longPollWaiters.delete(deviceId);
  for (const w of waiters) {
    clearTimeout(w.timeoutHandle);
    w.resolve({ cmd, cmdId });
  }

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

/**
 * Register a long-poll waiter for a device.
 * Resolves immediately if there's already a pending command.
 * Otherwise holds open for up to LONG_POLL_MS.
 * @returns {Promise<{cmd, cmdId} | null>}
 */
function waitForCommand(deviceId) {
  // Already a command waiting — return immediately
  const existing = pendingCmdByDevice.get(deviceId);
  if (existing) return Promise.resolve({ cmd: existing.cmd, cmdId: existing.cmdId });

  return new Promise(resolve => {
    const timeoutHandle = setTimeout(() => {
      // Remove this waiter from the list
      const list = longPollWaiters.get(deviceId) || [];
      longPollWaiters.set(deviceId, list.filter(w => w.resolve !== resolve));
      resolve(null); // null = no command, car should poll again later
    }, LONG_POLL_MS);

    const waiter = { resolve, timeoutHandle };
    const list   = longPollWaiters.get(deviceId) || [];
    list.push(waiter);
    longPollWaiters.set(deviceId, list);
  });
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

module.exports = { requireAuth, queueCommand, getPendingCommand, waitForCommand, resolveCommand };
