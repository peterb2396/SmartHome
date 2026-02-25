/**
 * GPIO Service
 * ─────────────────────────────────────────────────────────────────
 * Handles all hardware directly wired to the Raspberry Pi:
 *   • PIR motion sensor  (GPIO 22) — foyer light automation
 *   • Garage door sensor (GPIO 24) — reed switch, reports open/closed
 *   • Window sensors     (GPIO 5, 6, 13) — reed switches, one per window
 *   • Garage door relay  (GPIO 23) — pulse to trigger door
 *
 * Pin numbering: BCM GPIO numbers.
 * onoff uses /sys/class/gpio — createPin() handles the offset.
 *
 * Reed switch wiring:
 *   One leg → GPIO pin
 *   Other leg → GND
 *   Closed (magnet present) = LOW = "closed"
 *   Open  (magnet absent)   = HIGH = "open"
 *
 * Add or remove sensors in the REED_SWITCHES config array below.
 */

const sensors = require('./sensorStore');

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

// ── Reed switch configuration ────────────────────────────────────────────────
// Add a new entry here for each sensor wired directly to the Pi.
// name     → sensor key  →  GET /sensors/<name>
// pin      → BCM GPIO number
// location → stored in metadata
const REED_SWITCHES = [
  { name: 'garage',         pin: 24, location: 'Garage door'     },
  { name: 'window-front',   pin:  5, location: 'Front window'    },
  { name: 'window-back',    pin:  6, location: 'Back window'     },
  { name: 'window-bedroom', pin: 13, location: 'Bedroom window'  },
  // Add more here:
  // { name: 'window-office', pin: 19, location: 'Office window' },
];

// ── Main init ────────────────────────────────────────────────────────────────
function init() {
  if (process.platform !== 'linux' || process.env.DISABLE_GPIO) {
    console.log('[GPIO] Skipping hardware init (not Linux or DISABLE_GPIO set).');
    return;
  }

  process.on('SIGINT', () => { pins.forEach(p => p.unexport()); process.exit(); });

  setupPIR();
  setupReedSwitches();
  setupGarageRelay();
}

// ── PIR motion sensor ────────────────────────────────────────────────────────
function setupPIR() {
  const { isAfterSunset } = require('./astro');
  const { lights }        = require('./lights');

  const FOYER_LIGHT_ID = process.env.FOYER_LIGHT_ID || '50746520-3906-4528-8473-b7735a0600e9';
  const FOYER_ON_LEVEL = 45;
  const FOYER_TIMEOUT  = 45000;

  const pir = createPin(22, 'in', 'rising');
  let timer = null;

  pir.watch((err) => {
    if (err) { console.error('[GPIO] PIR error:', err); return; }
    if (!isAfterSunset()) return;

    console.log('[GPIO] Motion detected — foyer light on.');
    lights([FOYER_LIGHT_ID], true, process.env.PASSWORD, FOYER_ON_LEVEL);

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      lights([FOYER_LIGHT_ID], false, process.env.PASSWORD);
      timer = null;
    }, FOYER_TIMEOUT);
  });

  console.log('[GPIO] PIR sensor active on GPIO 22.');
}

// ── Reed switches (garage door + windows) ───────────────────────────────────
function setupReedSwitches() {
  for (const sw of REED_SWITCHES) {
    setupReedSwitch(sw.name, sw.pin, sw.location);
  }
}

function setupReedSwitch(name, bcmPin, location) {
  const pin      = createPin(bcmPin, 'in', 'both', { activeLow: false, reconfigureDirection: false });
  const toStatus = value => (value === 0 ? 'closed' : 'open');

  // Read and store initial state immediately on boot
  try {
    const initial = pin.readSync();
    sensors.set(name, toStatus(initial), null, { location, source: 'gpio', pin: bcmPin });
    console.log(`[GPIO] ${name} (GPIO ${bcmPin}): initially ${toStatus(initial)}`);
  } catch (e) {
    console.warn(`[GPIO] Could not read initial state of ${name}:`, e.message);
  }

  // Watch for open/close changes
  pin.watch((err, value) => {
    if (err) { console.error(`[GPIO] ${name} error:`, err); return; }
    const status = toStatus(value);
    sensors.set(name, status, null, { location, source: 'gpio', pin: bcmPin });
    console.log(`[GPIO] ${name}: ${status}`);
  });

  console.log(`[GPIO] Reed switch "${name}" watching on GPIO ${bcmPin}.`);
}

// ── Garage door relay ────────────────────────────────────────────────────────
// Separate OUTPUT pin that pulses to physically trigger the door motor.
// Reading the status (reed switch above) and triggering are two different pins.
const GARAGE_RELAY_BCM = 23;
let garageRelayPin = null;

function setupGarageRelay() {
  garageRelayPin = createPin(GARAGE_RELAY_BCM, 'out');
  garageRelayPin.writeSync(0);
  console.log(`[GPIO] Garage relay on GPIO ${GARAGE_RELAY_BCM}.`);
}

/**
 * Pulse the garage relay to trigger the door open/close.
 * @param {number} [durationMs=500]
 * @returns {Promise<{ok:boolean, lastKnownStatus:string}>}
 */
function triggerGarageDoor(durationMs = 500) {
  return new Promise((resolve, reject) => {
    if (!garageRelayPin) {
      resolve({ ok: false, reason: 'GPIO not available on this platform' });
      return;
    }
    try {
      garageRelayPin.writeSync(1);
      setTimeout(() => {
        garageRelayPin.writeSync(0);
        const current = sensors.get('garage');
        console.log(`[GPIO] Garage door pulsed. Last known: ${current?.value ?? 'unknown'}`);
        resolve({ ok: true, lastKnownStatus: current?.value ?? 'unknown' });
      }, durationMs);
    } catch (err) {
      reject(err);
    }
  });
}

// ── Generic button helper ────────────────────────────────────────────────────
function pressButton(pin, durationMs) {
  return new Promise(resolve => {
    pin.writeSync(1);
    setTimeout(() => { pin.writeSync(0); resolve(); }, durationMs);
  });
}

module.exports = { init, createPin, triggerGarageDoor, pressButton };
