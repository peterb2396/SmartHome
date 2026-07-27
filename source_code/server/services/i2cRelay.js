/**
 * I2C Relay Driver
 * ─────────────────────────────────────────────────────────────────
 * Generic driver for XL9535/PCA9535/TCA9535-register-compatible 8-channel
 * I2C relay boards (e.g. the JESSINIE XL9535-K8V5 board) — daisy-chained
 * on one I2C bus, each board given a unique address via its A0/A1/A2
 * jumpers (0x20 default, +1 per jumper bridged, up to 0x27 for 8 boards
 * on one bus).
 *
 * Deliberately generic/modular: this file knows nothing about zones,
 * dampers, or the air handler — it only knows "board at this address,
 * channel 0-7, on or off." To wire up a new board for an unrelated future
 * purpose, register its address and define logical relays pointing at
 * {address, channel} in whatever service owns that hardware — nothing in
 * this file needs to change.
 *
 * ── Register map (PCA9535/TCA9535/XL9535-compatible) ─────────────────
 *   0x00/0x01  Input Port 0/1      (read)
 *   0x02/0x03  Output Port 0/1     (write — what we use)
 *   0x04/0x05  Polarity Invert 0/1 (unused, left at power-on default)
 *   0x06/0x07  Configuration 0/1   (0=output, 1=input per bit; we want 0)
 * These boards populate Port 0 only (8 channels: bit0=CH1 ... bit7=CH8).
 * VERIFY against your board's silkscreen on first power-up — if channels
 * come out reversed or land on Port 1 instead, that's a one-line change to
 * OUTPUT_PORT0/CONFIG_PORT0 below, nothing else changes.
 *
 * Writing 1 = relay ON on this board family (confirmed against the
 * XL9535-KxV5 reference driver's behavior). If yours is wired active-LOW
 * instead, flip ACTIVE_HIGH below — check with a multimeter on channel 1
 * before wiring anything real to it.
 */

const OUTPUT_PORT0 = 0x02;
const CONFIG_PORT0 = 0x06;
const ACTIVE_HIGH = true;
const I2C_BUS_NUMBER = 1; // Pi's primary I2C bus (/dev/i2c-1 — SDA=GPIO2, SCL=GPIO3)

let i2cBus = null;
let usingMock = true;
const boards = new Map(); // address -> { outputState: 8-bit int }

function openBus() {
  let i2c;
  try {
    i2c = require('i2c-bus');
  } catch {
    console.warn('[I2CRelay] i2c-bus package unavailable — using mock transport. This is expected off the Pi.');
    return;
  }
  try {
    i2cBus = i2c.openSync(I2C_BUS_NUMBER);
    usingMock = false;
    console.log(`[I2CRelay] Bus /dev/i2c-${I2C_BUS_NUMBER} open.`);
  } catch (e) {
    console.warn(`[I2CRelay] Couldn't open /dev/i2c-${I2C_BUS_NUMBER} (${e.message}) — using mock transport. This is expected off the Pi.`);
  }
}

// Idempotent — configures all 8 channels as outputs, all initially off.
// Called automatically by setChannel() the first time a board's address is
// used, so nothing else needs to explicitly "register" a board first.
function registerBoard(address) {
  if (boards.has(address)) return boards.get(address);
  const board = { address, outputState: 0x00 };
  boards.set(address, board);
  if (!usingMock) {
    try {
      i2cBus.writeByteSync(address, CONFIG_PORT0, 0x00);
      i2cBus.writeByteSync(address, OUTPUT_PORT0, 0x00);
    } catch (e) {
      console.error(`[I2CRelay] Failed to initialize board 0x${address.toString(16)}:`, e.message);
    }
  }
  return board;
}

// channel: 0-7 (CH1-CH8 on the board's silkscreen)
function setChannel(address, channel, on) {
  const board = boards.get(address) ?? registerBoard(address);
  const bit = 1 << channel;
  const wantBitSet = ACTIVE_HIGH ? on : !on;
  const nextState = wantBitSet ? (board.outputState | bit) : (board.outputState & ~bit);
  if (nextState === board.outputState) return; // no change — skip the write, same reasoning as faultLed.js's writeIfChanged
  board.outputState = nextState;

  if (usingMock) {
    console.log(`[I2CRelay Mock] board 0x${address.toString(16)} ch${channel + 1} -> ${on ? 'ON' : 'off'}`);
    return;
  }
  try {
    i2cBus.writeByteSync(address, OUTPUT_PORT0, nextState);
  } catch (e) {
    console.error(`[I2CRelay] Write failed (board 0x${address.toString(16)}, ch${channel + 1}):`, e.message);
  }
}

function getChannel(address, channel) {
  const board = boards.get(address);
  if (!board) return false;
  const bit = 1 << channel;
  const rawBitSet = !!(board.outputState & bit);
  return ACTIVE_HIGH ? rawBitSet : !rawBitSet;
}

// All relays on every known board off — used on graceful shutdown so a
// planned restart doesn't leave anything energized.
function allOff() {
  for (const address of boards.keys()) {
    for (let ch = 0; ch < 8; ch++) setChannel(address, ch, false);
  }
}

function init() {
  openBus();
}

module.exports = { init, registerBoard, setChannel, getChannel, allOff };
