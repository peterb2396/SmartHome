/**
 * Fault LED
 * ─────────────────────────────────────────────────────────────────
 * Two discrete LEDs (simpler to wire than one RGB LED for two states) on
 * the basement Pi: red blinks while any fault is active (see faults.js),
 * yellow blinks when a maintenance task is due and there's no active
 * fault. Fault takes priority — a fault is more urgent than a due
 * maintenance item, so the two never blink at once.
 *
 * Wiring: GPIO 5 → red LED (+resistor) → GND. GPIO 6 → yellow LED
 * (+resistor) → GND. Both pins were freed up by removing the window reed
 * switches that used to live there — see gpio.js.
 */

const gpioSvc = require('./gpio');
const faultsSvc = require('./faults');
const maintenanceSvc = require('./maintenance');

const RED_LED_BCM = 5;
const YELLOW_LED_BCM = 6;
const BLINK_MS = 500;

let redPin = null;
let yellowPin = null;
let blinkOn = false;
let lastRed = 0;
let lastYellow = 0;

// Only actually writes a pin when its value changes — on the mock driver
// (dev machines, DISABLE_GPIO) every writeSync() logs a line, and this
// runs twice a second; writing unconditionally would flood the console
// (and the Console page's Terminal, which mirrors it) with a mock log line
// every tick even when nothing changed.
function writeIfChanged(pin, last, value) {
  if (value !== last) pin.writeSync(value);
  return value;
}

function tick() {
  blinkOn = !blinkOn;
  const hasFault = faultsSvc.getFaults().length > 0;
  const hasMaintenanceDue = maintenanceSvc.getState().tasks.some(t => t.isDue);

  const redValue = hasFault && blinkOn ? 1 : 0;
  const yellowValue = !hasFault && hasMaintenanceDue && blinkOn ? 1 : 0;
  lastRed = writeIfChanged(redPin, lastRed, redValue);
  lastYellow = writeIfChanged(yellowPin, lastYellow, yellowValue);
}

function init() {
  // A blinking LED has no observable value in the mock driver — nothing
  // reads it back, so simulating the blink would just be a mock log line
  // twice a second, forever, for as long as any fault is active (which is
  // often, in dev, since most sensors have nothing real wired to them yet).
  // Same real-hardware gate gpio.js's own init() uses.
  if (process.platform !== 'linux' || process.env.DISABLE_GPIO) {
    console.log('[FaultLed] Skipping (not Linux or DISABLE_GPIO set).');
    return;
  }
  redPin = gpioSvc.createPin(RED_LED_BCM, 'out');
  yellowPin = gpioSvc.createPin(YELLOW_LED_BCM, 'out');
  redPin.writeSync(0);
  yellowPin.writeSync(0);
  setInterval(tick, BLINK_MS);
  console.log('[FaultLed] Initialized.');
}

module.exports = { init };
