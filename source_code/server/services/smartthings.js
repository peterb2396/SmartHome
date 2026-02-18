const axios   = require('axios');
const settingsSvc = require('./settings');

const CLIENT_ID     = process.env.SMART_CLIENT_ID;
const CLIENT_SECRET = process.env.SMART_CLIENT_SECRET;
const BASE_URL      = 'https://api.smartthings.com/v1';

function headers() {
  return { Authorization: `Bearer ${settingsSvc.get().accessToken}` };
}

// ── Token management ────────────────────────────────────────────────────────────

async function refreshToken() {
  try {
    const { data } = await axios.post(
      'https://api.smartthings.com/oauth/token',
      new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     CLIENT_ID,
        refresh_token: settingsSvc.get().refreshToken || '',
      }),
      {
        auth:    { username: CLIENT_ID, password: CLIENT_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    await settingsSvc.updateSetting('accessToken',  data.access_token);
    await settingsSvc.updateSetting('refreshToken', data.refresh_token);
    console.log('[SmartThings] Token refreshed.');
    return data.access_token;
  } catch (err) {
    console.error('[SmartThings] Token refresh failed:', err.response?.data ?? err.message);
  }
}

// ── Device listing ───────────────────────────────────────────────────────────────

async function listDevices() {
  try {
    const { data } = await axios.get(`${BASE_URL}/devices`, { headers: headers() });

    const devicesWithStatus = await Promise.all(
      data.items.map(async device => {
        try {
          const { data: status } = await axios.get(
            `${BASE_URL}/devices/${device.deviceId}/status`,
            { headers: headers() }
          );
          return { ...device, status };
        } catch {
          return device;
        }
      })
    );

    return devicesWithStatus;
  } catch (err) {
    if (err.response?.status === 401) {
      console.log('[SmartThings] Unauthorized — refreshing token and retrying…');
      await refreshToken();
      return listDevices();
    }
    throw new Error('[SmartThings] Failed to list devices: ' + err.message);
  }
}

// ── Device commands ─────────────────────────────────────────────────────────────

async function sendCommands(deviceId, commands) {
  try {
    await axios.post(
      `${BASE_URL}/devices/${deviceId}/commands`,
      { commands },
      { headers: headers() }
    );
  } catch (err) {
    if (err.response?.status === 429) {
      const retry = err.response.headers['x-ratelimit-reset'] || 1000;
      console.warn(`[SmartThings] Rate limited. Retrying in ${retry}ms…`);
      await new Promise(r => setTimeout(r, retry));
      return sendCommands(deviceId, commands);
    }
    throw err;
  }
}

async function getDeviceStatus(deviceId) {
  const { data } = await axios.get(
    `${BASE_URL}/devices/${deviceId}/status`,
    { headers: headers() }
  );
  return data;
}

module.exports = { refreshToken, listDevices, sendCommands, getDeviceStatus };
