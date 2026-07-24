/**
 * Log Stream
 * ─────────────────────────────────────────────────────────────────
 * Wraps console.log/warn/error once at boot so server output can also be
 * viewed live on the Console page's terminal panel, over Server-Sent
 * Events — the app's first real-time push channel (everything else is
 * REST + polling). SSE was chosen over websockets specifically because
 * this is the only place that needs a live channel; a one-way server->
 * client event stream doesn't need a new dependency (native EventSource
 * on the browser side, plain res.write() chunks here).
 *
 * Ring buffer keeps the last MAX_LINES so a viewer who opens the page
 * after something happened can still see recent history, not just
 * whatever's logged after they connect.
 */

const MAX_LINES = 500;
const HEARTBEAT_MS = 20000; // keeps the SSE connection alive through proxies

const buffer = [];
const subscribers = new Set(); // Set<express.Response>
let installed = false;

function push(level, args) {
  const message = args.map(a => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
  const entry = { level, message, timestamp: new Date().toISOString() };
  buffer.push(entry);
  if (buffer.length > MAX_LINES) buffer.shift();
  for (const res of subscribers) writeEvent(res, entry);
}

function safeStringify(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function writeEvent(res, entry) {
  try {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  } catch {
    subscribers.delete(res);
  }
}

// Idempotent — safe to call once at boot even if init() somehow runs twice.
function install() {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      push(level, args);
    };
  }
}

function subscribe(res) {
  subscribers.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, HEARTBEAT_MS);
  res.on('close', () => { subscribers.delete(res); clearInterval(heartbeat); });
}

function getRecent() {
  return buffer.slice();
}

module.exports = { install, subscribe, getRecent };
