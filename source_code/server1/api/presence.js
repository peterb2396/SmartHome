/**
 * Presence Routes — Arrive / Leave
 * ─────────────────────────────────────────────────────────────────
 * POST /arrive
 * POST /leave
 */

const router      = require('express').Router();
const settingsSvc = require('../services/settings');
const smartthings = require('../services/smartthings');
const lightsSvc   = require('../services/lights');
const astro       = require('../services/astro');
const tuya        = require('../services/tuya');
const { sendPush } = require('../services/mail');

// ── Leave ───────────────────────────────────────────────────────────────────────

router.post('/leave', tuya.tokenMiddleware, async (req, res) => {
  try {
    await settingsSvc.refresh();
    const settings   = settingsSvc.get();
    const username   = req.body.who || 'Anonymous';
    const password   = req.body.password;
    const whenAway   = (settings.whenAway || '').split(',').map(s => s.trim()).filter(Boolean);
    const allDevices = await smartthings.listDevices();

    console.log(`[Presence] ${username} left the house.`);

    // Remove user from usersHome
    const usersHome = (settings.usersHome || []).filter(u => u !== username);
    await settingsSvc.updateSetting('usersHome', usersHome);
    const homeEmpty = usersHome.length === 0;

    // Find all SmartThings lights that are currently on
    const lightDevices = allDevices.filter(d =>
      d.name.startsWith('c2c') && !d.name.includes('switch')
    );

    const lightsOn = [];
    for (const device of lightDevices) {
      const status = await smartthings.getDeviceStatus(device.deviceId);
      if (status?.components?.main?.switch?.switch?.value === 'on') {
        lightsOn.push({
          label:    device.label,
          deviceId: device.deviceId,
          roomId:   device.roomId,
          level:    status.components.main.switchLevel?.level?.value,
        });
      }
    }

    // Persist lights-on list for restoration on arrival
    await settingsSvc.updateSetting('lightsOn', lightsOn);

    // Filter to only this user's lights unless home is now empty
    const myLights = homeEmpty
      ? lightsOn
      : lightsOn.filter(d => settings.lights?.[d.deviceId]?.owner === username);

    console.log(`[Presence] Turning off ${homeEmpty ? 'all' : username + "'s"} lights:`,
      myLights.map(d => d.label || d.deviceId));

    await lightsSvc.lights(myLights, false, password);

    // If home is empty, activate the "when away" lights
    if (homeEmpty && whenAway.length > 0) {
      const awayDevices = allDevices
        .filter(d =>
          whenAway.includes(d.roomId) ||
          whenAway.includes(d.deviceId) ||
          whenAway.includes(d.label)
        )
        .map(d => d.deviceId);

      await lightsSvc.lights(awayDevices, true, password);
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
    const password   = req.body.password;
    const whenAway   = (settings.whenAway || '').split(',').map(s => s.trim()).filter(Boolean);
    const tempLights = (settings.temp_lights || '').split(',').map(s => s.trim()).filter(Boolean);
    const allDevices = await smartthings.listDevices();

    console.log(`[Presence] ${username} arrived home.`);

    // Push notification for anyone that isn't the main user
    if (username !== 'pete.buo') {
      sendPush(
        `${username.charAt(0).toUpperCase()}${username.slice(1)} arrived home!`,
        'Home'
      );
    }

    // Turn off the "when away" lights
    if (whenAway.length > 0) {
      const awayDevices = allDevices
        .filter(d =>
          whenAway.includes(d.roomId) ||
          whenAway.includes(d.deviceId) ||
          whenAway.includes(d.label)
        )
        .map(d => d.deviceId);
      await lightsSvc.lights(awayDevices, false, password);
    }

    // Determine which lights to restore
    const othersHome = Array.isArray(settings.usersHome) && settings.usersHome.length > 0;
    let lightsOn = (settings.lightsOn || []).filter(d => {
      if (othersHome) return settings.lights?.[d.deviceId]?.owner === username;
      return !settings.lights?.[d.deviceId]?.owner ||
             settings.lights?.[d.deviceId]?.owner === username;
    });

    // After sunset: also turn on temp/arrival lights
    if (astro.isAfterSunset() && tempLights.length > 0) {
      const tempDevices = allDevices.filter(d =>
        tempLights.includes(d.roomId) ||
        tempLights.includes(d.deviceId) ||
        tempLights.includes(d.label)
      );
      lightsOn = [...lightsOn, ...tempDevices];
    }

    console.log(`[Presence] Restoring ${username}'s lights:`,
      lightsOn.map(d => d.label || d.deviceId));
    await lightsSvc.lights(lightsOn, true, password);

    // Update usersHome
    const usersHome = Array.isArray(settings.usersHome) ? settings.usersHome : [settings.usersHome];
    if (!usersHome.includes(username)) {
      await settingsSvc.updateSetting('usersHome', [...usersHome, username]);
    }

    // Schedule temp lights to turn off
    if (tempLights.length > 0) {
      const tempDevices = lightsOn.filter(d =>
        tempLights.includes(d.roomId) ||
        tempLights.includes(d.deviceId) ||
        tempLights.includes(d.label)
      );

      if (tempDevices.length > 0) {
        if (global._tempLightTimeout) clearTimeout(global._tempLightTimeout);
        const delayMs = (settings.temp_mins || 0.1) * 60 * 1000;
        console.log(`[Presence] Turning off temp lights in ${settings.temp_mins ?? 0.1} min.`);
        global._tempLightTimeout = setTimeout(async () => {
          await lightsSvc.lights(tempDevices, false, password);
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
