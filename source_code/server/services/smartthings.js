/**
 * SmartThings Service
 * ─────────────────────────────────────────────────────────────────
 * Smart plugs + appliances only now — actual light/fan switches are all
 * Lutron Caseta, controlled locally via lutron.js instead (see that file).
 * This still needs to work for whatever SmartThings devices exist today
 * and any added later.
 *
 * Uses the official @smartthings/core-sdk (confirmed to load and run fine
 * on this Pi's Node 20.19.4 despite its package.json claiming node>=22 —
 * tested directly before relying on it) for both the device REST calls
 * (list/status/commands) AND token refresh, via a single shared
 * SequentialRefreshTokenAuthenticator instance.
 *
 * Earlier this file kept its own hand-rolled refresh + 401-catch-retry
 * logic, reasoning that the SDK's authenticator had no concurrency
 * protection. That was wrong — re-read after tracing the actual call path
 * (node_modules/@smartthings/core-sdk/dist/endpoint-client.js's request()):
 * on a 401, if the configured authenticator exposes acquireRefreshMutex(),
 * the SDK automatically acquires it, calls refresh(), and releases it
 * before retrying the original request — genuine protection against the
 * exact race (concurrent 401s both consuming the same single-use rotating
 * refresh token) that killed the token which started this rewrite, as long
 * as every call shares the SAME authenticator instance below (never
 * construct a fresh one per call — that would give each call its own
 * mutex, defeating the point).
 */

const { SmartThingsClient, SequentialRefreshTokenAuthenticator, globalSmartThingsURLProvider } = require('@smartthings/core-sdk');
const { Mutex } = require('async-mutex');
const settingsSvc = require('./settings');

// The SDK builds its axios calls with no timeout at all (checked
// endpoint-client.js — nothing in its config is ever read into axios'
// `timeout` option), so a stalled connection to SmartThings hangs the
// calling request forever instead of failing. Every SDK call below gets
// wrapped in this so a network stall surfaces as a clear error instead of
// an indefinitely spinning frontend.
const REQUEST_TIMEOUT_MS = 15000;
function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[SmartThings] ${label} timed out after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const CLIENT_ID     = process.env.SMART_CLIENT_ID;
const CLIENT_SECRET = process.env.SMART_CLIENT_SECRET;
// Overridable for testing against a fake local server — always the real
// SmartThings API in production.
const urlProvider = process.env.SMARTTHINGS_BASE_URL
  ? { baseURL: process.env.SMARTTHINGS_BASE_URL }
  : globalSmartThingsURLProvider;

// Reads/writes the token pair via the exact same settings keys the rest of
// this app already uses (and that smartthingsLifecycle.js's webhook
// handler writes to on INSTALL/UPDATE).
const tokenStore = {
  async getRefreshData() {
    const s = settingsSvc.get();
    return { refreshToken: s?.refreshToken || '', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
  },
  async putAuthData({ authToken, refreshToken }) {
    // One atomic write — see settings.js's updateSettings() comment. Two
    // separate updateSetting() calls here is what left the access/refresh
    // token pair able to land mismatched (fresh access token, stale
    // already-consumed refresh token) if anything landed between them.
    await settingsSvc.updateSettings({ accessToken: authToken, refreshToken });
    console.log('[SmartThings] Token refreshed.');
  },
};

// One shared Mutex + one shared authenticator instance for the whole
// process — see this file's header comment for why "shared" is the part
// that actually matters here.
const refreshMutex = new Mutex();
const authenticator = new SequentialRefreshTokenAuthenticator(
  settingsSvc.get()?.accessToken || '', // may be empty at module-load time if settings.init() hasn't finished yet — self-corrects on the first 401
  tokenStore,
  refreshMutex
);

// The mutex only stops concurrent refreshes from CORRUPTING each other
// (see this file's header comment) — it does nothing to stop them from
// being wasteful. Every request that hits a 401 queues on the mutex and
// then does its OWN real network round-trip to /oauth/token once it's
// through, even if the request ahead of it in the queue refreshed the
// token a moment ago and it's now perfectly valid. Under normal polling
// this compounded into a real refresh call roughly every second (measured
// live: 448 in under 7 minutes) — every device-list/light-toggle request
// paying for an extra network round-trip it didn't need, which is what
// made everything feel slow and made light toggles seem to silently do
// nothing. Wrapping refresh() with a short cooldown means only the first
// caller in a burst actually hits the network; anyone else within the
// window just reuses the token that was just minted.
const MIN_REFRESH_INTERVAL_MS = 5000;
let lastRefreshAt = 0;
const originalAuthenticatorRefresh = authenticator.refresh.bind(authenticator);
authenticator.refresh = async function (clientConfig) {
  if (Date.now() - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
    return { Authorization: `Bearer ${authenticator.token}` };
  }
  const headers = await originalAuthenticatorRefresh(clientConfig);
  lastRefreshAt = Date.now();
  return headers;
};

function client() {
  return new SmartThingsClient(authenticator, { urlProvider });
}

// Exposed for astro.js's midnight cron — some OAuth providers quietly
// invalidate a refresh token after a long stretch of it never being used,
// even if it was never actually expired-and-401'd, so proactively
// exercising it periodically (not just reactively on a 401) has real
// value on top of the SDK's own automatic on-401 refresh above.
//
// Must go through the same mutex EndpointClient.request() uses internally
// on a 401 — this used to call authenticator.refresh() directly, which
// bypassed the mutex entirely. If this cron's refresh ever overlapped with
// a real request's automatic 401-triggered refresh, both could POST the
// same single-use rotating refresh token at once; only one succeeds and
// the other silently kills the token (invalid_grant on every call after).
async function refreshToken() {
  const release = await authenticator.acquireRefreshMutex();
  try {
    await withTimeout(authenticator.refresh({ authenticator, urlProvider }), 'Token refresh');
  } finally {
    release();
  }
}

// ── Device listing ───────────────────────────────────────────────────────────────

async function listDevices() {
  try {
    const st = client();
    const devices = await withTimeout(st.devices.list(), 'Device list');
    return await Promise.all(
      devices.map(async device => {
        try {
          const status = await withTimeout(st.devices.getStatus(device.deviceId), `Status for ${device.deviceId}`);
          return { ...device, status };
        } catch {
          return device;
        }
      })
    );
  } catch (err) {
    // A dead refresh token (invalid_grant) surfaces here, since the SDK's
    // own automatic refresh-and-retry has nothing further to fall back to
    // — err.message already has the raw SmartThings error body appended
    // (see endpoint-client.js's error annotation), no need to duplicate it.
    throw new Error('[SmartThings] Failed to list devices: ' + err.message);
  }
}

// ── Device commands ─────────────────────────────────────────────────────────────

async function sendCommands(deviceId, commands) {
  try {
    await withTimeout(client().devices.executeCommands(deviceId, commands), `Send commands to ${deviceId}`);
  } catch (err) {
    if (err?.response?.status === 429 || err?.status === 429) {
      const retry = err.response?.headers?.['x-ratelimit-reset'] || 1000;
      console.warn(`[SmartThings] Rate limited. Retrying in ${retry}ms…`);
      await new Promise(r => setTimeout(r, retry));
      return sendCommands(deviceId, commands);
    }
    throw err;
  }
}

async function getDeviceStatus(deviceId) {
  return withTimeout(client().devices.getStatus(deviceId), `Status for ${deviceId}`);
}

module.exports = { refreshToken, listDevices, sendCommands, getDeviceStatus };
