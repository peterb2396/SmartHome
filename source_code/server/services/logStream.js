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

// Was 500 — a single sustained failure logging once per 10s poll cycle
// alone produces 360 lines/hour, which blew through a 500-line buffer in
// under 90 minutes and crowded out every other service's logs entirely,
// including whatever ran around the actual moment something broke. Bigger
// buffer + throttling the repeat-offender log lines themselves (see
// rs485.js's pollNode()) both matter — this alone isn't the whole fix.
const MAX_LINES = 5000;
const HEARTBEAT_MS = 20000; // keeps the SSE connection alive through proxies

const buffer = [];
const subscribers = new Set(); // Set<express.Response>
let installed = false;

// Every service in this app already logs with a `[ServiceName] ...` prefix
// by convention (see gpio.js, rs485.js, boiler.js, etc.) — reuse that
// instead of threading an explicit source tag through every console.log
// call. Lines with no bracket prefix (rare — the odd bare console.log)
// group under 'other'.
function sourceFor(message) {
  const match = message.match(/^\[([^\]]+)\]/);
  return match ? match[1] : 'other';
}

function push(level, args) {
  const message = args.map(a => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
  const entry = { level, message, timestamp: new Date().toISOString(), source: sourceFor(message) };
  buffer.push(entry);
  if (buffer.length > MAX_LINES) buffer.shift();
  for (const res of subscribers) writeEvent(res, entry);
}

function safeStringify(value) {
  // Error objects carry message/stack as non-enumerable properties, so
  // JSON.stringify(err) silently produces "{}" — exactly the kind of
  // swallowed error that makes a failing request look like it did nothing.
  if (value instanceof Error) return value.stack || value.message;
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
