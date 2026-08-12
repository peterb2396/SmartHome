const User     = require('../db/userModel');
const settingsSvc   = require('./settings');
const smartthings   = require('./smartthings');

// ── Password validation ─────────────────────────────────────────────────────────

async function validatePassword(password) {
  if (password === process.env.PASSWORD) return true;
  try {
    const user = await User.findOne({ _id: password });
    return !!user;
  } catch {
    return false;
  }
}

// ── Main lights controller ──────────────────────────────────────────────────────
// SmartThings-only — actual Lutron Caseta switches/fans are controlled
// directly via lutron.js/api/lutron.js now (local Telnet, no SmartThings
// dependency at all). This function is what's left for smart plugs and
// anything else still routed through SmartThings.

/**
 * Control one or more devices via SmartThings.
 * @param {string[]|Object[]|null} lightDevices  Array of deviceIds, device objects, or null for all
 * @param {boolean}  on       Turn on (true) or off (false)
 * @param {string}   password Auth password or user _id
 * @param {number}   [level]  Brightness 0–100
 */
async function lights(lightDevices = null, on = true, password, level) {
  if (!await validatePassword(password)) return;

  await settingsSvc.refresh();
  const allLights = await smartthings.listDevices();
  const targets   = lightDevices ?? allLights;

  for (const light of targets) {
    const deviceId = light.deviceId ?? light;
    const lightObj = allLights.find(d => d.deviceId === deviceId);
    const isFan    = lightObj?.name?.toLowerCase().includes('fan');

    const commands = level
      ? [
          { capability: 'switch', command: on ? 'on' : 'off' },
          {
            capability: isFan ? 'fanSpeed' : 'switchLevel',
            command:    isFan ? 'setFanSpeed' : 'setLevel',
            arguments:  [on ? (light.level ?? level) : 0],
          },
        ]
      : [{ capability: 'switch', command: on ? 'on' : 'off' }];

    await smartthings.sendCommands(deviceId, commands);
  }
}

module.exports = { lights, validatePassword };
