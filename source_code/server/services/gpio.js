// GPIO service — only active on Linux. Provides a mock on macOS/Windows.

const GpioDriver = (() => {
  if (process.platform === 'linux') {
    return require('onoff').Gpio;
  }
  // Mock for dev on macOS/Windows
  return function MockGpio() {
    return {
      writeSync: v  => console.log(`[GPIO Mock] write ${v}`),
      readSync:  () => 0,
      watch:     () => {},
      unexport:  () => {},
    };
  };
})();

const pins = []; // track all created pins for cleanup

function createPin(number, ...args) {
  const pin = new GpioDriver(number + 512, ...args);
  pins.push(pin);
  return pin;
}

function cleanup() {
  pins.forEach(p => p.unexport());
}

// ── Peripheral setup ────────────────────────────────────────────────────────────
// Called once from api/index.js after settings are loaded.

function init() {
  if (process.platform !== 'linux' || process.env.DISABLE_GPIO) {
    console.log('[GPIO] Skipping — not on Linux or DISABLE_GPIO set.');
    return;
  }

  process.on('SIGINT', () => { cleanup(); process.exit(); });

  setupPIR();
}

// ── PIR motion sensor ───────────────────────────────────────────────────────────
// Detects motion in foyer and turns on foyer light at night.

function setupPIR() {
  const { isAfterSunset }   = require('./astro');
  const { lights }          = require('./lights');
  const FOYER_LIGHT         = process.env.FOYER_LIGHT_ID || '50746520-3906-4528-8473-b7735a0600e9';
  const FOYER_TIMEOUT_MS    = 45_000;

  const pir = createPin(22, 'in', 'rising');
  let foyerTimer = null;

  pir.watch((err) => {
    if (err) { console.error('[GPIO] PIR error:', err); return; }

    if (!isAfterSunset()) return;

    console.log('[GPIO] Motion detected — turning on foyer light.');
    lights([FOYER_LIGHT], true, process.env.PASSWORD, 45);

    if (foyerTimer) clearTimeout(foyerTimer);
    foyerTimer = setTimeout(() => {
      lights([FOYER_LIGHT], false, process.env.PASSWORD);
      foyerTimer = null;
    }, FOYER_TIMEOUT_MS);
  });

  console.log('[GPIO] PIR sensor watching on GPIO22.');
}

// ── Garage door ─────────────────────────────────────────────────────────────────
// Toggle a relay pin to momentarily press the garage door button.
// Pin numbers here are the logical GPIO numbers (512 offset applied by createPin).

const GARAGE_RELAY_PIN = 23; // Change to match your wiring
let garagePin = null;

function getGaragePin() {
  if (!garagePin && process.platform === 'linux' && !process.env.DISABLE_GPIO) {
    garagePin = createPin(GARAGE_RELAY_PIN, 'out');
  }
  return garagePin;
}

/**
 * Briefly pulse the garage relay (simulates button press).
 * @param {number} [durationMs=500]
 */
function triggerGarageDoor(durationMs = 500) {
  return new Promise((resolve, reject) => {
    const pin = getGaragePin();
    if (!pin) { resolve({ ok: false, reason: 'GPIO not available' }); return; }
    try {
      pin.writeSync(1);
      setTimeout(() => {
        pin.writeSync(0);
        console.log('[GPIO] Garage door pulsed.');
        resolve({ ok: true });
      }, durationMs);
    } catch (err) {
      reject(err);
    }
  });
}

// ── Generic button helper ───────────────────────────────────────────────────────
function pressButton(pin, durationMs) {
  return new Promise(resolve => {
    pin.writeSync(1);
    setTimeout(() => { pin.writeSync(0); resolve(); }, durationMs);
  });
}

module.exports = { init, createPin, cleanup, triggerGarageDoor, pressButton };
