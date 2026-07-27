/**
 * GPIO Service
 * ─────────────────────────────────────────────────────────────────
 * Handles all hardware directly wired to the Raspberry Pi:
 *   • PIR motion sensor (GPIO 22) — foyer light automation
 *   • Fault LED (GPIO 5 red, GPIO 6 yellow) — see faultLed.js, which owns
 *     the blink logic but uses createPin() from here like everything else
 *   • HVAC fault input (GPIO 26) — see setupHvacFault() below. Reads the
 *     air handler's `ALARM` output (CN33) — a passive dry contact, normally
 *     open, closing when the AHU detects a fault. Being passive (unlike the
 *     `L` terminal, which actively outputs 24V) it's wired straight to the
 *     Pi's own 3.3V with no relay/opto-isolator needed: COM to 3.3V, NO to
 *     GPIO 26. Pull-down is GPIO 26's *internal* pull (configured via
 *     `gpio=26=ip,pd` in /boot/firmware/config.txt, since `onoff` doesn't
 *     set pulls itself) rather than an external resistor. See the wiring
 *     guide.
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
  setupHvacFault();
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

// ── HVAC fault input ─────────────────────────────────────────────────────────
// Direct 3.3V read of the air handler's `ALARM` output (CN33) — a passive
// dry contact (normally open, closes on fault), so it's wired straight to
// the Pi's own 3.3V with no relay/opto-isolator needed — see the wiring
// guide. HIGH = the AHU currently has an active fault; LOW = normal.
// Latched into hvacFaultActive so faults.js can read it synchronously
// without touching GPIO internals, exactly like sensorStore/thermostat's
// runtime state.
let hvacFaultActive = false;

function setupHvacFault() {
  const { sendPush } = require('./mail');

  const pin = createPin(26, 'in', 'both');
  hvacFaultActive = !!pin.readSync(); // pick up a fault that was already active before boot, not just future edges

  pin.watch((err, value) => {
    if (err) { console.error('[GPIO] HVAC fault pin error:', err); return; }
    const active = !!value;
    if (active === hvacFaultActive) return;
    hvacFaultActive = active;
    if (active) {
      console.warn('[GPIO] HVAC fault signal (ALARM) active.');
      sendPush('The air handler is reporting an active fault (ALARM signal).', 'CRITICAL: HVAC Fault');
    } else {
      console.log('[GPIO] HVAC fault signal (ALARM) cleared.');
      sendPush('The air handler fault signal has cleared.', 'HVAC: Resolved');
    }
  });

  console.log(`[GPIO] HVAC fault input active on GPIO 26 (currently ${hvacFaultActive ? 'FAULT' : 'normal'}).`);
}

function isHvacFaultActive() {
  return hvacFaultActive;
}

// ── Generic button helper ────────────────────────────────────────────────────
function pressButton(pin, durationMs) {
  return new Promise(resolve => {
    pin.writeSync(1);
    setTimeout(() => { pin.writeSync(0); resolve(); }, durationMs);
  });
}

module.exports = { init, createPin, pressButton, isHvacFaultActive };
