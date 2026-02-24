const axios  = require('axios');
const crypto = require('crypto');

const ACCESS_ID     = process.env.ACCESS_ID;
const ACCESS_SECRET = process.env.ACCESS_SECRET;
const BASE_URL      = 'https://openapi.tuyaus.com';

let accessToken = null;
let tokenExpiry = 0;

// ── Signature helpers ───────────────────────────────────────────────────────────

function hmacSha256(str, secret) {
  return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
}

function sha256(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function buildSignature({ tokenMode, timestamp, method, path, body = '' }) {
  const contentHash = sha256(body);
  const stringToSign = [method, contentHash, '', path].join('\n');
  const base = tokenMode
    ? ACCESS_ID + timestamp + stringToSign
    : ACCESS_ID + accessToken + timestamp + stringToSign;
  return hmacSha256(base, ACCESS_SECRET);
}

// ── Token management ────────────────────────────────────────────────────────────

async function fetchAccessToken() {
  const timestamp = Date.now().toString();
  const path      = '/v1.0/token?grant_type=1';
  const sign      = buildSignature({ tokenMode: true, timestamp, method: 'GET', path });

  const { data } = await axios.get(`${BASE_URL}${path}`, {
    headers: {
      client_id:   ACCESS_ID,
      sign,
      t:           timestamp,
      sign_method: 'HMAC-SHA256',
    },
  });

  if (!data.success) throw new Error(`Tuya token error: ${data.msg}`);

  accessToken = data.result.access_token;
  tokenExpiry = Date.now() + data.result.expire_time * 1000;
  console.log('[Tuya] Access token fetched.');
}

async function ensureToken() {
  if (!accessToken || Date.now() >= tokenExpiry) await fetchAccessToken();
}

// ── Device control ───────────────────────────────────────────────────────────────

/**
 * Send a command body to a Tuya device.
 * @param {string} deviceId  Tuya device ID (or index into DEVICES env array)
 * @param {string} body      JSON string of the command payload
 */
async function controlDevice(deviceId, body) {
  await ensureToken();

  const devices  = JSON.parse(process.env.DEVICES || '[]');
  const id       = Number.isInteger(Number(deviceId)) ? devices[deviceId] : deviceId;
  const path     = `/v1.0/devices/${id}/commands`;
  const timestamp = Date.now().toString();
  const sign     = buildSignature({ tokenMode: false, timestamp, method: 'POST', path, body });

  const { data } = await axios.post(`${BASE_URL}${path}`, JSON.parse(body), {
    headers: {
      client_id:    ACCESS_ID,
      access_token: accessToken,
      sign,
      t:            timestamp,
      sign_method:  'HMAC-SHA256',
    },
  });

  return data;
}

/**
 * Toggle a Tuya smart plug.
 * @param {string}  deviceId  Tuya device ID or index
 * @param {boolean} on        On or off
 */
async function powerPlug(deviceId, on) {
  const body = JSON.stringify({ commands: [{ code: 'switch_1', value: on }] });
  return controlDevice(deviceId, body);
}

// Express middleware — ensures token is fresh before route handler runs
async function tokenMiddleware(req, res, next) {
  try {
    await ensureToken();
    next();
  } catch (err) {
    console.error('[Tuya] Token middleware error:', err);
    res.status(500).json({ error: 'Failed to fetch Tuya access token' });
  }
}

module.exports = { ensureToken, controlDevice, powerPlug, tokenMiddleware };
