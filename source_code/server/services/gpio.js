/**
 * GPIO Service
 * ─────────────────────────────────────────────────────────────────
 * Handles all hardware directly wired to the Raspberry Pi:
 *   • PIR motion sensor (GPIO 22) — foyer light automation
 *   • Fault LED (GPIO 5 red, GPIO 6 yellow) — see faultLed.js, which owns
 *     the blink logic but uses createPin() from here like everything else
 *
 * Pin numbering: BCM GPIO numbers.
 * onoff uses /sys/class/gpio — createPin() handles the offset.
 *
 * No door/window reed switches or a garage relay are wired right now —
 * removed along with all their references elsewhere in the app. Re-add
 * following the same createPin()/watch() pattern as setupPIR() below if
 * that hardware gets wired again.
 */

// ── Platform-aware GPIO driver ───────────────────────────────────────────────
const GpioDriver = (() => {
  if (process.platform === 'linux' && !process.env.DISABLE_GPIO) {
    try { return require('onoff').Gpio; } catch {}
  }
  // Mock for macOS / Windows dev machines
  return function MockGpio(pin) {
    return {
      writeSync: v  => console.log(`[GPIO Mock] pin ${pin} write ${v}`),
      readSync:  () => 0,
      watch:     () => console.log(`[GPIO Mock] pin ${pin} watching`),
      unexport:  () => {},
    };
  };
})();

const pins = [];

// Need to add 512 to the BCM number to get the correct /sys/class/gpio pin on Raspberry Pi
function createPin(bcmNumber, ...args) {
  const pin = new GpioDriver(bcmNumber + 512, ...args);
  pins.push(pin);
  return pin;
}

// ── Main init ────────────────────────────────────────────────────────────────
function init() {
  if (process.platform !== 'linux' || process.env.DISABLE_GPIO) {
    console.log('[GPIO] Skipping hardware init (not Linux or DISABLE_GPIO set).');
    return;
  }

  process.on('SIGINT', () => { pins.forEach(p => p.unexport()); process.exit(); });

  setupPIR();
}

// ── PIR motion sensor ────────────────────────────────────────────────────────
function setupPIR() {
  const { isAfterSunset } = require('./astro');
  const { lights }        = require('./lights');
  const smartthings       = require('./smartthings');

  const FOYER_LIGHT_ID = process.env.FOYER_LIGHT_ID || '50746520-3906-4528-8473-b7735a0600e9';
  // 41% is deliberately not a level the Lutron Caseta wall dimmer can be set
  // to by hand (its physical presets/ramp land on round numbers). That makes
  // it a reliable marker for "the PIR set this light" — see the timer below,
  // which uses it to tell a motion-triggered light apart from a person who
  // turned the light on (or re-set its brightness) themselves.
  const FOYER_ON_LEVEL = 41;
  const FOYER_TIMEOUT  = 45000;

  const pir = createPin(22, 'in', 'rising');
  let timer = null;

  pir.watch(async (err) => {
    if (err) { console.error('[GPIO] PIR error:', err); return; }
    if (!isAfterSunset()) return;

    // Only take over a light that's currently off. If it's already on —
    // whether from a previous motion trigger or someone turning it on by
    // hand — leave it alone entirely; a person controlling their own light
    // always wins over the motion automation.
    let status;
    try {
      status = await smartthings.getDeviceStatus(FOYER_LIGHT_ID);
    } catch (e) {
      console.warn('[GPIO] Could not read foyer light status, skipping motion trigger:', e.message);
      return;
    }
    if (status?.components?.main?.switch?.switch?.value === 'on') return;

    console.log('[GPIO] Motion detected — foyer light on.');
    lights([FOYER_LIGHT_ID], true, process.env.PASSWORD, FOYER_ON_LEVEL);

    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      // Only auto-off if the brightness is still exactly what the PIR set.
      // Any manual change since then (dimmer or app, to any other level)
      // means a person has taken over — the timer backs off instead of
      // fighting them.
      let current;
      try {
        current = await smartthings.getDeviceStatus(FOYER_LIGHT_ID);
      } catch (e) {
        console.warn('[GPIO] Could not verify foyer light level before auto-off:', e.message);
        return;
      }
      if (current?.components?.main?.switchLevel?.level?.value !== FOYER_ON_LEVEL) return;
      lights([FOYER_LIGHT_ID], false, process.env.PASSWORD);
    }, FOYER_TIMEOUT);
  });

  console.log('[GPIO] PIR sensor active on GPIO 22.');
}

// ── Generic button helper ────────────────────────────────────────────────────
function pressButton(pin, durationMs) {
  return new Promise(resolve => {
    pin.writeSync(1);
    setTimeout(() => { pin.writeSync(0); resolve(); }, durationMs);
  });
}

module.exports = { init, createPin, pressButton };
