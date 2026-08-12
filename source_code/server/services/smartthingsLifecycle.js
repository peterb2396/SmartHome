/**
 * SmartThings Webhook Lifecycle Handler
 * ─────────────────────────────────────────────────────────────────
 * NOT YET VERIFIED AGAINST A REAL SmartThings LIFECYCLE EVENT — written
 * against the documented @smartthings/smartapp SDK and lifecycle payload
 * shapes, but there's no way to trigger a real PING/CONFIRMATION/INSTALL
 * from here. Treat the first real event (reconfiguring the "SmartHomeNode"
 * automation from the SmartThings mobile app) as a bring-up: watch the
 * server logs — enableEventLogging() below dumps every raw lifecycle
 * payload SmartThings sends, which is the fastest way to spot a mismatch
 * between what this expects and what actually arrives.
 *
 * This SmartApp is registered in the SmartThings developer workspace as a
 * "Webhook" hosted app ("SmartHomeNode" project) — a fundamentally
 * different integration model from a browser-redirect OAuth app (which is
 * what an earlier version of this file's surrounding code assumed, and
 * has since been removed — see smartthings.js): SmartThings calls THIS
 * server directly with lifecycle events —
 *   PING          liveness check, must echo pingData.challenge back
 *   CONFIRMATION  sent once at registration; must be confirmed by GETing
 *                 confirmationData.confirmationUrl (handled automatically
 *                 by the SDK below, no manual click needed)
 *   INSTALL       sent when a user adds this app to an automation from the
 *                 SmartThings mobile app — carries a fresh access/refresh
 *                 token pair, no user-facing redirect involved at all
 *   UPDATE        sent when that automation's config changes — also
 *                 carries a fresh token pair
 *   UNINSTALL     sent when the automation is removed
 * Tokens land in the exact same settings keys (`accessToken`/
 * `refreshToken`) smartthings.js's REST client already reads — this
 * file's only job is keeping those current.
 *
 * Uses the official @smartthings/smartapp SDK rather than hand-parsing
 * the lifecycle JSON, specifically because SmartThings signs every
 * request (HTTP Signature, RSA-SHA256 against a rotating public key it
 * publishes) and verifying that correctly by hand is real, easy-to-get-
 * subtly-wrong cryptography — not something to reimplement when the SDK
 * already does it correctly. This also means a request that fails
 * signature verification is rejected before ever reaching the handlers
 * below, so a spoofed POST to this endpoint can't plant fake tokens.
 */

const SmartApp = require('@smartthings/smartapp');
const settingsSvc = require('./settings');

async function storeTokens(context, eventLabel) {
  if (!context.authToken || !context.refreshToken) {
    console.warn(`[SmartThings Lifecycle] ${eventLabel} had no authToken/refreshToken — nothing to store.`);
    return;
  }
  await settingsSvc.updateSetting('accessToken', context.authToken);
  await settingsSvc.updateSetting('refreshToken', context.refreshToken);
  console.log(`[SmartThings Lifecycle] ${eventLabel}: stored a fresh access/refresh token pair.`);
}

const smartapp = new SmartApp()
  .enableEventLogging(2) // dumps raw lifecycle payloads — remove once a real INSTALL is confirmed working
  // Deliberately no .configureI18n() — that's for translating config-page
  // text shown in the SmartThings mobile app, which this SmartApp doesn't
  // have (no .page() calls, no user-facing strings). It also crashes at
  // startup by default (looks for a ./locales directory that doesn't
  // exist in this project) — found that the hard way running this file.
  .installed(async (context) => {
    await storeTokens(context, 'INSTALL');
  })
  .updated(async (context) => {
    await storeTokens(context, 'UPDATE');
  })
  .uninstalled(async () => {
    // Deliberately not clearing stored tokens — a later reinstall just
    // overwrites them via installed() above, and clearing here would only
    // add a way to accidentally break the REST client (smartthings.js)
    // for no real benefit.
    console.log('[SmartThings Lifecycle] UNINSTALL received.');
  });

// Express handler — see api/smarthome.js's POST /smartthings-webhook.
// The SDK reads the raw lifecycle field off req.body itself and calls
// whichever handler above matches (or answers PING/CONFIRMATION directly)
// before this ever needs to inspect the payload.
function handleWebhook(req, res) {
  smartapp.handleHttpCallback(req, res);
}

module.exports = { handleWebhook };
