const axios  = require('axios');
const moment = require('moment');
const cron   = require('node-cron');
const settingsSvc = require('./settings');
const calendar    = require('./calendar');

// ── Location ───────────────────────────────────────────────────────────────────
const LAT = 41.722034;  // Wellsboro, PA
const LNG = -77.263969;
const TZ  = 'America/New_York';

const ASTRO_URL = `https://api.sunrise-sunset.org/json?lat=${LAT}&lng=${LNG}&formatted=0`;

let eveningDark  = null;
let morningLight = null;

// ── Core fetch ──────────────────────────────────────────────────────────────────
async function fetchAstroData() {
  try {
    const { data } = await axios.get(ASTRO_URL);
    const { sunset, sunrise, astronomical_twilight_end, astronomical_twilight_begin } = data.results;

    const now = moment();
    eveningDark  = moment.utc(sunset).local();
    morningLight = moment.utc(sunrise).local();

    // If we've passed today's sunset, advance sunrise to tomorrow
    if (now.isAfter(eveningDark)) morningLight.add(1, 'day');

    const astroEnd   = moment.utc(astronomical_twilight_end).local();
    const astroBegin = moment.utc(astronomical_twilight_begin).local();
    if (now.isAfter(astroEnd)) astroBegin.add(1, 'day');

    await settingsSvc.updateSetting('stargazingStart', astroEnd.format('h:mm'));
    await settingsSvc.updateSetting('stargazingEnd',   astroBegin.format('h:mm'));
    await settingsSvc.updateSetting('sunset',  eveningDark.format('h:mm'));
    await settingsSvc.updateSetting('sunrise', morningLight.format('h:mm'));

    console.log(`[Astro] Sunrise: ${morningLight.format('h:mm A')}  Sunset: ${eveningDark.format('h:mm A')}`);
  } catch (err) {
    console.error('[Astro] Error fetching data:', err.message);
  }
}

function isAfterSunset() {
  if (!morningLight || !eveningDark) return false;
  return !moment().isBetween(morningLight, eveningDark);
}

// ── Weather helper ──────────────────────────────────────────────────────────────
async function getTempFAt7am(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${LAT}&longitude=${LNG}` +
    `&hourly=temperature_2m&temperature_unit=fahrenheit` +
    `&timezone=${encodeURIComponent(TZ)}` +
    `&start_date=${y}-${m}-${d}&end_date=${y}-${m}-${d}`;

  const { data } = await axios.get(url, { timeout: 12000 });
  const times = data?.hourly?.time || [];
  const temps = data?.hourly?.temperature_2m || [];
  const target = `${y}-${m}-${d}T07:00`;
  const idx = times.indexOf(target);
  if (idx === -1) throw new Error(`No 07:00 reading for ${target}`);
  return temps[idx];
}

// ── Car start helper ────────────────────────────────────────────────────────────
// Imported lazily to avoid circular deps
async function maybeStartCar(tag) {
  const now = new Date();
  try {
    if (!calendar.shouldRunToday(now)) {
      console.log(`[AutoStart] Skip (${tag}): not an eligible workday.`);
      return;
    }
    const tempF = await getTempFAt7am(now);
    const triggers = tempF < 60 || tempF > 80;
    if (!triggers) {
      console.log(`[AutoStart] Skip (${tag}): temp ${tempF}°F is comfortable (60–80°F).`);
      return;
    }
    console.log(`[AutoStart] Conditions met (${tag}). Temp ${tempF}°F. Ready to start car.`);
    // Uncomment when garage door control is wired up:
    // const { queueDeviceCmd } = require('../services/vehicleQueue');
    // await queueDeviceCmd('SUBURBAN', 'start');
  } catch (err) {
    console.error(`[AutoStart] Error (${tag}):`, err.message);
  }
}

// ── Cron jobs ───────────────────────────────────────────────────────────────────
function scheduleCronJobs() {
  const opts = { scheduled: true, timezone: TZ };

  // Refresh astro data + SmartThings token at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron] Midnight maintenance');
    await fetchAstroData();
    const smartthings = require('./smartthings');
    await smartthings.refreshToken();
  }, opts);

  // Auto-start car at 7:00 AM
  cron.schedule('0 7 * * *', () => {
    console.log('[Cron] 07:00 triggered');
    maybeStartCar('07:00');
  }, opts);

  // Retry at 7:11 AM
  cron.schedule('11 7 * * *', () => {
    console.log('[Cron] 07:11 triggered');
    maybeStartCar('07:11');
  }, opts);
}

// ── Ping keepalive ───────────────────────────────────────────────────────────────
function schedulePing() {
  const url = process.env.PING_URL;
  if (!url) {
    console.log('[Ping] PING_URL not set, skipping.');
    return;
  }
  const ping = () =>
    axios.get(url)
      .then(r => console.log('[Ping]', r.data))
      .catch(() => setTimeout(ping, 2000));

  cron.schedule('*/10 * * * *', ping);
  ping();
}

async function init() {
  await fetchAstroData();
  scheduleCronJobs();
  schedulePing();
}

module.exports = { init, fetchAstroData, isAfterSunset, getTempFAt7am, LAT, LNG, TZ };
