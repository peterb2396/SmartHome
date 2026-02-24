const net      = require('net');
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

// ── Lutron control (Telnet) ─────────────────────────────────────────────────────

function lutron(id, brightness) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.connect(23, '192.168.4.32', () => {
      client.write('login: lutron\r\n');
      setTimeout(() => client.write('integration\r\n'), 500);
      setTimeout(() => {
        const cmd = `#OUTPUT,${id},1,${brightness}\r\n`;
        client.write(cmd);
        console.log(`[Lutron] Sent: ${cmd.trim()}`);
      }, 1000);
      setTimeout(() => { client.destroy(); resolve(true); }, 1500);
    });
    client.on('error', err => { console.error('[Lutron] Error:', err); reject(err); });
    client.on('close', () => console.log(`[Lutron] Connection closed for device ${id}`));
  });
}

// ── Main lights controller ──────────────────────────────────────────────────────

/**
 * Control one or more lights.
 * @param {string[]|Object[]|null} lightDevices  Array of deviceIds, device objects, or null for all
 * @param {boolean}  on       Turn on (true) or off (false)
 * @param {string}   password Auth password or user _id
 * @param {number}   [level]  Brightness 0–100
 */
async function lights(lightDevices = null, on = true, password, level) {
  if (!await validatePassword(password)) return;

  await settingsSvc.refresh();
  const settings  = settingsSvc.get();
  const allLights = await smartthings.listDevices();
  const targets   = lightDevices ?? allLights;

  for (const light of targets) {
    const deviceId     = light.deviceId ?? light;
    const deviceConfig = settings.lights?.[deviceId];

    // Try Lutron first if configured
    if (deviceConfig?.lutronId) {
      try {
        await lutron(deviceConfig.lutronId, on ? (level ?? 100) : 0);
        continue;
      } catch {
        // fall through to SmartThings
      }
    }

    // SmartThings fallback
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

module.exports = { lights, validatePassword, lutron };
