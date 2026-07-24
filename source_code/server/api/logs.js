/**
 * Log Routes
 * ─────────────────────────────────────────────────────────────────
 * GET /console/logs/recent — buffered backfill for a viewer that just opened the page
 * GET /console/logs/stream — SSE, live server console output
 *
 * Same Bearer-token admin auth as the camera management routes. The stream
 * route additionally accepts the token as a `?token=` query param, since
 * browsers' native EventSource can't set an Authorization header — the
 * standard accepted workaround for SSE auth.
 */

const router = require('express').Router();
const logStream = require('../services/logStream');

function isAdmin(req) {
  const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const token = headerToken || (req.query.token || '').trim();
  return token === process.env.ADMIN_UID;
}

router.get('/console/logs/recent', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  res.json({ lines: logStream.getRecent() });
});

router.get('/console/logs/stream', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  logStream.subscribe(res);
});

module.exports = router;
