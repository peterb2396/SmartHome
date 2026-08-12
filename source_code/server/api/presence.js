/**
 * Presence Routes — Arrive / Leave
 * ─────────────────────────────────────────────────────────────────
 * POST /arrive
 * POST /leave
 *
 * Lights here are 100% Lutron now (see lutron.js) — this file no longer
 * touches SmartThings at all, since all switches are Lutron Caseta.
 * whenAway/temp_lights settings match against a Lutron device's `room`,
 * `integrationId` (as a string), or `name` — same three-way match the
 * original SmartThings-based version did against roomId/deviceId/label,
 * just against the new identifiers. Existing saved values for those
 * settings were written against the old SmartThings identifiers and won't
 * match anything anymore — they'll need re-entering against room names/
 * device names from the Lights page.
 */

const router      = require('express').Router();
const settingsSvc = require('../services/settings');
const lutron      = require('../services/lutron');
const astro       = require('../services/astro');
const tuya        = require('../services/tuya');
const { sendPush } = require('../services/mail');

function matchesTarget(device, targets) {
  return targets.includes(device.room) || targets.includes(String(device.integrationId)) || targets.includes(device.name);
}

async function setDevices(devices, on) {
  for (const d of devices) {
    try {
      await lutron.setDevice(d.integrationId, { on, level: d.level });
    } catch (err) {
      console.warn(`[Presence] Couldn't set "${d.name}":`, err.message);
    }
  }
}

// ── Leave ───────────────────────────────────────────────────────────────────────

router.post('/leave', tuya.tokenMiddleware, async (req, res) => {
  try {
    await settingsSvc.refresh();
    const settings   = settingsSvc.get();
    const username   = req.body.who || 'Anonymous';
    const whenAway   = (settings.whenAway || '').split(',').map(s => s.trim()).filter(Boolean);

    console.log(`[Presence] ${username} left the house.`);

    // Remove user from usersHome
    const usersHome = (settings.usersHome || []).filter(u => u !== username);
    await settingsSvc.updateSetting('usersHome', usersHome);
    const homeEmpty = usersHome.length === 0;

    const { devices } = lutron.getState();
    const lightsOn = devices
      .filter(d => d.on)
      .map(d => ({ integrationId: d.integrationId, name: d.name, room: d.room, owner: d.owner, level: d.level }));

    // Persist lights-on list for restoration on arrival
    await settingsSvc.updateSetting('lightsOn', lightsOn);

    // Filter to only this user's lights unless home is now empty
    const myLights = homeEmpty ? lightsOn : lightsOn.filter(d => d.owner === username);

    console.log(`[Presence] Turning off ${homeEmpty ? 'all' : username + "'s"} lights:`,
      myLights.map(d => d.name));
    await setDevices(myLights, false);

    // If home is empty, activate the "when away" lights
    if (homeEmpty && whenAway.length > 0) {
      const awayDevices = devices.filter(d => matchesTarget(d, whenAway));
      await setDevices(awayDevices, true);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[/leave]', err);
    res.status(500).json({ error: 'Failed to process leave request' });
  }
});

// ── Arrive ──────────────────────────────────────────────────────────────────────

router.post('/arrive', tuya.tokenMiddleware, async (req, res) => {
  try {
    await settingsSvc.refresh();
    const settings   = settingsSvc.get();
    const username   = req.body.who || 'Anonymous';
    const whenAway   = (settings.whenAway || '').split(',').map(s => s.trim()).filter(Boolean);
    const tempLights = (settings.temp_lights || '').split(',').map(s => s.trim()).filter(Boolean);

    console.log(`[Presence] ${username} arrived home.`);

    // Push notification for anyone that isn't the main user
    if (username !== 'pete.buo') {
      sendPush(
        `${username.charAt(0).toUpperCase()}${username.slice(1)} arrived home!`,
        'Home'
      );
    }

    const { devices } = lutron.getState();

    // Turn off the "when away" lights
    if (whenAway.length > 0) {
      const awayDevices = devices.filter(d => matchesTarget(d, whenAway));
      await setDevices(awayDevices, false);
    }

    // Determine which lights to restore
    const othersHome = Array.isArray(settings.usersHome) && settings.usersHome.length > 0;
    let lightsOn = (settings.lightsOn || []).filter(d => {
      if (othersHome) return d.owner === username;
      return !d.owner || d.owner === username;
    });

    // After sunset: also turn on temp/arrival lights
    if (astro.isAfterSunset() && tempLights.length > 0) {
      const tempDevices = devices
        .filter(d => matchesTarget(d, tempLights))
        .map(d => ({ integrationId: d.integrationId, name: d.name, room: d.room, owner: d.owner, level: d.level }));
      lightsOn = [...lightsOn, ...tempDevices];
    }

    console.log(`[Presence] Restoring ${username}'s lights:`,
      lightsOn.map(d => d.name));
    await setDevices(lightsOn, true);

    // Update usersHome
    const usersHome = Array.isArray(settings.usersHome) ? settings.usersHome : [settings.usersHome];
    if (!usersHome.includes(username)) {
      await settingsSvc.updateSetting('usersHome', [...usersHome, username]);
    }

    // Schedule temp lights to turn off
    if (tempLights.length > 0) {
      const tempDevices = lightsOn.filter(d => matchesTarget(d, tempLights));

      if (tempDevices.length > 0) {
        if (global._tempLightTimeout) clearTimeout(global._tempLightTimeout);
        const delayMs = (settings.temp_mins || 0.1) * 60 * 1000;
        console.log(`[Presence] Turning off temp lights in ${settings.temp_mins ?? 0.1} min.`);
        global._tempLightTimeout = setTimeout(async () => {
          await setDevices(tempDevices, false);
          global._tempLightTimeout = null;
        }, delayMs);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[/arrive]', err);
    res.status(500).json({ error: 'Failed to process arrive request' });
  }
});

module.exports = router;
