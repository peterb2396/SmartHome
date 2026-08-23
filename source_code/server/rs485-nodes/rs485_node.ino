/**
 * RS485 Sensor Node (RP2040)
 * ─────────────────────────────────────────────────────────────────
 * Confirmed working against real hardware (basement node) — temp, humidity,
 * VOC, and CO2 all landing in REPORTs and reaching the frontend. New nodes:
 * watch Serial monitor output, confirm ANNOUNCE frames arrive at the Pi
 * (`server/services/rs485.js`, also visible live on the Console page's
 * Terminal panel), then confirm sensor values land on a REPORT.
 *
 * Pure I/O transport, same role as server/esp32/suburban_node.ino's
 * relationship to the car-tracking logic — no decision logic here, just
 * read sensors and answer the bus master's polls. Every zone runs one of
 * these; multiple nodes share one RS485 bus (a pair of wires), and the
 * master (rs485.js, connected via a USB-to-RS485 adapter on the Pi)
 * addresses each node individually.
 *
 * ── I2C dial bridge (see HAS_DIAL below) ───────────────────────────
 * This is the ONE mass-produced board — a wall dial (server/rs485-nodes/
 * dial_node.ino, an ESP32 touch+rotary display) is NOT a separate RS485
 * node; it's an I2C ACCESSORY hanging off THIS board, exactly like the
 * BME680/SCD41 sensors are, sharing the same I2C0 bus (a 3rd device
 * address alongside them, no separate bus needed) and the same 5V rail
 * off this board's own LM2596. This board answers RS485 for BOTH roles on
 * ONE bus address: CMD_POLL/CMD_REPORT for its own sensors (if HAS_SCD41/
 * a BME680 are present) and CMD_POLL_DIAL/CMD_DIAL_STATE for the attached
 * dial (if HAS_DIAL). See bridgeDialPoll() below — the bridge is a pure
 * byte-for-byte relay between RS485 and I2C; this board never needs to
 * understand the dial payload's structure, just shuttle it. The dial
 * itself carries NO RS485 logic at all and doesn't need to know this bus
 * exists — see that file's own header.
 *
 * ── Hardware per node ────────────────────────────────────────────
 *   RP2040 board (e.g. Pico, Pico W used purely for its RP2040 — no
 *     Wi-Fi needed for this node type)
 *   TTL-to-RS485 converter (e.g. MAX485/MAX3485 module) — DE and RE
 *     pins tied together on most breakout boards, driven from one GPIO
 *   LM2596 buck converter — steps the bus's 24V feed down to 5V for the
 *     RP2040's VSYS input (RP2040 logic itself is 3.3V, regulated on-board)
 *     — this same 5V rail also feeds an attached dial, if any
 *   Thermostat-zone nodes only: BME680 (temp/pressure/humidity/VOC) +
 *     SCD41 (CO2), both I2C
 *   Basement/attic monitor nodes: BME680 only, SCD41 omitted — set
 *     HAS_SCD41 to false below
 *   Zones with a wall dial: set HAS_DIAL to true below — no extra RP2040
 *     hardware needed beyond the existing I2C0 bus/5V rail already wired
 *     for the sensors
 *
 * ── Libraries (Arduino Library Manager) ───────────────────────────
 *   Adafruit BME680 Library     by Adafruit
 *   Adafruit Unified Sensor     by Adafruit
 *   SparkFun SCD4x Arduino Library   by SparkFun (needed for every build,
 *     even HAS_SCD41=false ones — see the note on HAS_SCD41 below for why)
 *   EEPROM                      bundled with arduino-pico core
 *
 * ── Wiring ───────────────────────────────────────────────────────
 *   RS485 module DI  (driver in / TX)   → RP2040 GPIO 0  (UART0 TX)
 *   RS485 module RO  (receiver out / RX) → RP2040 GPIO 1  (UART0 RX)
 *   RS485 module DE+RE (tied together)   → RP2040 GPIO 2
 *   RS485 module A/B                     → bus twisted pair (shared)
 *   BME680 SDA/SCL                       → RP2040 GPIO 4 / GPIO 5 (I2C0)
 *   SCD41  SDA/SCL                       → same I2C0 bus (if present)
 *   Dial   SDA/SCL/GND/5V                → same I2C0 bus + same 5V rail as
 *                                           the sensors (if present) — see
 *                                           dial_node.ino's own wiring notes
 *                                           for its side of this same link
 *   LM2596 OUT+ (5V)                     → RP2040 VSYS
 *   LM2596 OUT- / bus common             → RP2040 GND
 *
 * Bus address is assigned by the master (see ASSIGN in rs485.js) and
 * persisted to flash-emulated EEPROM — it survives power cycles. A node
 * ships with no address (0x00) and announces itself until configured from
 * the Console's "New Nodes" panel.
 *
 * ── Remote firmware update (see rs485.js's header for the wire protocol) ─
 * The Pi has no USB wire to a deployed node — only this RS485 pair — so a
 * pushed image arrives in small chunks over the SAME bus normal polling
 * uses, via Updater.h (arduino-pico's port of the ESP32/ESP8266 Update
 * library): it writes into an INACTIVE flash partition and only marks it
 * bootable after a clean finish, so an interrupted/corrupt push leaves
 * this board running its OLD firmware, not bricked. That safety only
 * holds if this exact sketch was compiled with an OTA-enabled "Flash
 * Size" option under Arduino IDE's Tools menu (RP2040 boards package) —
 * REQUIRED, one-time, per node, via USB, before remote updates can ever
 * work on it; a build without one just has no second partition to
 * receive into. UNVERIFIED against real hardware — confirm Updater.h's
 * exact API against your installed arduino-pico core version.
 *
 * ── Debug log relay (GET_LOG) ─────────────────────────────────────
 * logLine() (below) both Serial.prints (useful on the bench, unchanged)
 * and queues into a small ring buffer that GET_LOG drains one line per
 * poll — so field debug output (BME680/SCD41 not found, dial I2C errors,
 * etc.) shows up in the Console's log Terminal panel with no USB cable,
 * tagged by node name. Slow/round-robin on the master's side — debug
 * convenience riding along on production bus time, not control traffic.
 */

#include <Wire.h>
#include <EEPROM.h>
#include <Updater.h>
#include <stdarg.h>
#include <Adafruit_Sensor.h>
#include "Adafruit_BME680.h"
#include "pico/unique_id.h"

// ── Config — edit if your wiring differs ──────────────────────────
// A runtime bool, deliberately NOT gated behind #if — HAS_SCD41 is a real
// C++ variable, not a #define, so #if HAS_SCD41 would silently evaluate as
// #if 0 (the preprocessor treats any non-macro identifier as 0) and strip
// this entire feature out of every build regardless of this value. Learned
// that the hard way — see git history. The library/object below now always
// compile in; scd41 just never gets begin()'d or read when this is false.
const bool HAS_SCD41 = true; // false for basement/attic monitor nodes
const bool HAS_DIAL = true;  // false for zones with no wall dial attached

const int RS485_DE_RE_PIN = 2;
const unsigned long BAUD_RATE = 9600;
const unsigned long ANNOUNCE_INTERVAL_MS = 5000;  // while unconfigured
const unsigned long EEPROM_SIZE = 8;
const int EEPROM_ADDR_BYTE = 0; // where the assigned bus address lives

// Real production evidence (basement node, 2026-08-15 23:14): a perfectly
// clean 30-byte REPORT arrived on one poll, then the NEXT poll got zero
// bytes back — not garbled, not partial, total silence — for 12+ hours
// straight, until power-cycled. That rules out the RS485 parser stall
// fixed earlier (that bug always left some trace: a stray byte, a partial
// frame). Total silence starting exactly one cycle after a flawless
// exchange means loop() itself stopped running — and the only place
// handleFrame() blocks after a clean receive is sendReport()'s
// bme.performReading()/scd41.readMeasurement(), real I2C transactions
// with no timeout. RP2040's I2C peripheral has a known failure mode where
// a bus glitch (the same noise source that hits the RS485 line) makes a
// transaction hang forever instead of erroring out — and once loop() is
// stuck inside one, this node can never process another byte, from
// anything, ever again. Rather than chase every possible blocking call,
// a hardware watchdog is pet once per loop() iteration below; if
// anything ever hangs longer than this, the chip force-reboots itself
// instead of staying wedged until someone physically power-cycles it.
// 8000 is close to arduino-pico's hardware ceiling (~8388ms, a 24-bit
// counter) — plenty above one real loop() iteration (normally
// microseconds), tight enough that a hang self-heals in one poll cycle
// or two, not hours.
const unsigned long WATCHDOG_TIMEOUT_MS = 8000;

#include <SparkFun_SCD4x_Arduino_Library.h>
SCD4x scd41;
bool scd41Ready = false;

Adafruit_BME680 bme;
bool bmeReady = false;

// ── Protocol constants — MUST match server/services/rs485.js ─────
const uint8_t SYNC = 0xAA;
const uint8_t CMD_POLL = 0x01;
const uint8_t CMD_ASSIGN = 0x02;
const uint8_t CMD_SET_RELAY = 0x03;
const uint8_t CMD_POLL_DIAL = 0x04;
const uint8_t CMD_FW_BEGIN = 0x06;
const uint8_t CMD_FW_CHUNK = 0x07;
const uint8_t CMD_FW_END = 0x08;
const uint8_t CMD_GET_LOG = 0x09;
const uint8_t CMD_ANNOUNCE = 0x81;
const uint8_t CMD_REPORT = 0x82;
const uint8_t CMD_ACK = 0x83;
const uint8_t CMD_DIAL_STATE = 0x84;
const uint8_t CMD_FW_ACK = 0x86;
const uint8_t CMD_LOG_LINE = 0x87;

// ── I2C dial bridge — see this file's header ──────────────────────
// TBD: pick an address that doesn't collide with BME680 (0x76/0x77) or
// SCD41 (0x62) on the same bus — 0x42 is a placeholder, confirm/change if
// it conflicts with anything else you add to this bus later.
const uint8_t DIAL_I2C_ADDR = 0x42;
const uint8_t DIAL_PUSH_LEN = 27; // must match rs485.js's POLL_DIAL payload size
const uint8_t DIAL_REPLY_LEN = 8; // must match rs485.js's DIAL_STATE payload size

const uint8_t SENSOR_TEMPERATURE = 0x01;
const uint8_t SENSOR_HUMIDITY = 0x02;
const uint8_t SENSOR_PRESSURE = 0x03;
const uint8_t SENSOR_VOC = 0x04;
const uint8_t SENSOR_CO2 = 0x05;

uint8_t busAddress = 0x00; // 0x00 = unconfigured
uint8_t uniqueId[8];
unsigned long lastAnnounce = 0;
float gasBaselineOhms = 0; // learned on first few readings, for the VOC heuristic

// ── CRC8 (poly 0x07) — must match crc8() in rs485.js ──────────────
uint8_t crc8(const uint8_t* data, size_t len) {
  uint8_t crc = 0;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1);
    }
  }
  return crc;
}

// ── Debug log relay — see GET_LOG in this file's header ────────────
const uint8_t LOG_BUFFER_LINES = 8;
const uint8_t LOG_LINE_MAX_LEN = 30; // must match rs485.js's LOG_LINE payload budget
char logBuffer[LOG_BUFFER_LINES][LOG_LINE_MAX_LEN + 1];
uint8_t logHead = 0, logCount = 0;

void logLine(const char* fmt, ...) {
  char formatted[96];
  va_list args;
  va_start(args, fmt);
  vsnprintf(formatted, sizeof(formatted), fmt, args);
  va_end(args);
  Serial.println(formatted);

  // Ring buffer: write at the next free slot, or — once full — overwrite
  // the oldest and advance logHead past it (drop it), rather than block
  // or grow. (logHead+logCount)%N lands exactly on logHead once full,
  // which is what makes the overwrite-oldest behavior fall out for free.
  uint8_t writeIdx = (logHead + logCount) % LOG_BUFFER_LINES;
  strncpy(logBuffer[writeIdx], formatted, LOG_LINE_MAX_LEN);
  logBuffer[writeIdx][LOG_LINE_MAX_LEN] = '\0';
  if (logCount < LOG_BUFFER_LINES) logCount++;
  else logHead = (logHead + 1) % LOG_BUFFER_LINES;
}

// Fills out[LOG_LINE_MAX_LEN+1] and returns true if a line was queued.
bool popLogLine(char* out) {
  if (logCount == 0) return false;
  strncpy(out, logBuffer[logHead], LOG_LINE_MAX_LEN + 1);
  logHead = (logHead + 1) % LOG_BUFFER_LINES;
  logCount--;
  return true;
}

// ── Half-duplex send: assert DE/RE, write, wait for the line to clear ─
void sendFrame(uint8_t addr, uint8_t cmd, const uint8_t* payload, uint8_t len) {
  uint8_t head[3] = { addr, cmd, len };
  uint8_t crcInput[3 + 32];
  memcpy(crcInput, head, 3);
  if (len > 0) memcpy(crcInput + 3, payload, len);
  uint8_t crc = crc8(crcInput, 3 + len);

  digitalWrite(RS485_DE_RE_PIN, HIGH); // transmit mode
  delayMicroseconds(50);
  Serial1.write(SYNC);
  Serial1.write(head, 3);
  if (len > 0) Serial1.write(payload, len);
  Serial1.write(crc);
  Serial1.flush();
  delayMicroseconds(50);
  digitalWrite(RS485_DE_RE_PIN, LOW); // back to receive
}

void sendAnnounce() {
  uint8_t payload[9];
  memcpy(payload, uniqueId, 8);
  payload[8] = HAS_SCD41 ? 0x03 : 0x01; // capability bitmask, informational only today
  sendFrame(0x00, CMD_ANNOUNCE, payload, 9);
}

void appendReading(uint8_t* payload, uint8_t& offset, uint8_t type, float value) {
  payload[offset++] = type;
  memcpy(payload + offset, &value, 4);
  offset += 4;
}

void sendReport() {
  uint8_t payload[5 * 5]; // up to 5 readings
  uint8_t offset = 0;

  if (bmeReady && bme.performReading()) {
    appendReading(payload, offset, SENSOR_TEMPERATURE, bme.temperature * 9.0 / 5.0 + 32.0);
    appendReading(payload, offset, SENSOR_HUMIDITY, bme.humidity);
    appendReading(payload, offset, SENSOR_PRESSURE, bme.pressure / 100.0);
    appendReading(payload, offset, SENSOR_VOC, vocHeuristic(bme.gas_resistance));
  } else {
    logLine("[RS485 Node] BME680 read failed, skipping this report's readings.");
  }

  if (HAS_SCD41 && scd41Ready && scd41.readMeasurement()) {
    appendReading(payload, offset, SENSOR_CO2, (float)scd41.getCO2());
  }

  sendFrame(busAddress, CMD_REPORT, payload, offset);
}

// Relays a POLL_DIAL push straight through to the attached dial over I2C,
// then relays its DIAL_STATE reply straight back over RS485 — a pure
// byte-for-byte proxy, zero protocol translation. This board never parses
// the payload; it doesn't need to know target temps from volume percents
// from fault counts, it just moves DIAL_PUSH_LEN bytes one way and
// DIAL_REPLY_LEN bytes back. If the I2C exchange fails or comes back
// short, this simply doesn't reply over RS485 at all — indistinguishable
// to the master from a dropped frame, and it'll just retry next sweep
// (~20ms later), same as any other missed poll.
void bridgeDialPoll(uint8_t* pushPayload, uint8_t pushLen) {
  if (pushLen != DIAL_PUSH_LEN) return; // unexpected size — protocol mismatch, don't guess

  Wire.beginTransmission(DIAL_I2C_ADDR);
  Wire.write(pushPayload, pushLen);
  uint8_t writeResult = Wire.endTransmission();
  if (writeResult != 0) {
    logLine("[RS485 Node] Dial I2C write failed (code %d)", writeResult);
    return;
  }

  uint8_t got = Wire.requestFrom(DIAL_I2C_ADDR, DIAL_REPLY_LEN);
  if (got < DIAL_REPLY_LEN) {
    logLine("[RS485 Node] Dial I2C read short (%d/%d bytes)", got, DIAL_REPLY_LEN);
    while (Wire.available()) Wire.read(); // drain whatever partial reply there was
    return;
  }
  uint8_t reply[DIAL_REPLY_LEN];
  for (uint8_t i = 0; i < DIAL_REPLY_LEN; i++) reply[i] = Wire.read();
  sendFrame(busAddress, CMD_DIAL_STATE, reply, DIAL_REPLY_LEN);
}

// Rough baseline-relative heuristic, NOT a calibrated air-quality index —
// BME680's raw gas resistance needs Bosch's proprietary BSEC library for
// that, which has real licensing/integration hurdles (see the Console
// plan's notes). Higher resistance == cleaner air, so this normalizes
// against a self-learned baseline and inverts it into a 0-100 "worse air
// = lower score" scale that's at least directionally useful.
float vocHeuristic(float gasResistanceOhms) {
  if (gasBaselineOhms <= 0) gasBaselineOhms = gasResistanceOhms; // first reading seeds the baseline
  else gasBaselineOhms = gasBaselineOhms * 0.995 + gasResistanceOhms * 0.005; // slow-moving baseline

  float ratio = gasResistanceOhms / gasBaselineOhms; // >1 cleaner than baseline, <1 worse
  float score = 50.0 + (ratio - 1.0) * 100.0;
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

void loadAddressFromEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  busAddress = EEPROM.read(EEPROM_ADDR_BYTE);
  if (busAddress == 0xFF) busAddress = 0x00; // erased flash reads as 0xFF, treat as unconfigured
}

void saveAddressToEEPROM(uint8_t addr) {
  busAddress = addr;
  EEPROM.write(EEPROM_ADDR_BYTE, addr);
  EEPROM.commit();
}

// ── Receive + dispatch ─────────────────────────────────────────────
uint8_t rxBuf[64];
uint8_t rxLen = 0;

// Resync safety net, mirrors the Pi-side master's identical fix in
// server/services/rs485.js's onData() — read that comment for the full
// reasoning. Short version: a stray byte that happens to equal SYNC (bus
// noise — exactly what inadequate termination makes more likely) can make
// everything from here look like the start of a frame that will never
// actually complete. Left unchecked, this node waits at "not enough bytes
// yet" forever, on every single loop() iteration — meaning it silently
// stops parsing ANY future bytes, including real POLL requests from the
// master, even though it's still receiving them electrically. From the
// master's side that's indistinguishable from "the node died," and
// nothing clears rxBuf/rxLen except a power cycle, since nothing else in
// this file ever touches them. Two checks: an implausible len drops the
// sync byte immediately, a plausible-but-never-completing one times out.
const uint8_t MAX_PAYLOAD_LEN = 40; // largest real payload today is FW_CHUNK's 34B (2B seq + 32B data) — matches rs485.js's MAX_PAYLOAD_LEN
const unsigned long FRAME_STALL_MS = 500; // a full 30B frame takes ~30ms at 9600 baud — generous margin
bool awaitingFrame = false;
unsigned long awaitingFrameSince = 0;

void pollSerial() {
  while (Serial1.available()) {
    if (rxLen < sizeof(rxBuf)) rxBuf[rxLen++] = Serial1.read();
    else { rxLen = 0; awaitingFrame = false; } // overflow, drop and resync on next SYNC byte
  }
  if (rxLen < 4) { awaitingFrame = false; return; }

  // Find sync byte
  uint8_t start = 0;
  while (start < rxLen && rxBuf[start] != SYNC) start++;
  if (start > 0) { memmove(rxBuf, rxBuf + start, rxLen - start); rxLen -= start; }
  if (rxLen < 4) { awaitingFrame = false; return; }

  uint8_t len = rxBuf[3];
  if (len > MAX_PAYLOAD_LEN) {
    memmove(rxBuf, rxBuf + 1, rxLen - 1); // not a real header — drop just the sync byte, resync next call
    rxLen -= 1;
    awaitingFrame = false;
    return;
  }

  if (rxLen < (uint16_t)(4 + len + 1)) { // wait for full frame
    if (!awaitingFrame) { awaitingFrame = true; awaitingFrameSince = millis(); }
    else if (millis() - awaitingFrameSince > FRAME_STALL_MS) {
      memmove(rxBuf, rxBuf + 1, rxLen - 1);
      rxLen -= 1;
      awaitingFrame = false;
    }
    return;
  }
  awaitingFrame = false;

  uint8_t addr = rxBuf[1], cmd = rxBuf[2];
  uint8_t crc = crc8(rxBuf + 1, 3 + len);
  uint8_t receivedCrc = rxBuf[4 + len];
  uint8_t* payload = rxBuf + 4;

  if (crc == receivedCrc) handleFrame(addr, cmd, payload, len);

  uint8_t frameLen = 4 + len + 1;
  memmove(rxBuf, rxBuf + frameLen, rxLen - frameLen);
  rxLen -= frameLen;
}

// ── Remote firmware update — see this file's header + rs485.js's header ─
bool fwActive = false;
uint32_t fwExpectedSize = 0;
uint32_t fwExpectedCrc = 0;
uint32_t fwBytesWritten = 0;
uint32_t fwCrcState = 0xFFFFFFFF; // running, NOT yet inverted — inverted only when finalizing, see handleFwEnd()

// Same standard CRC-32 (IEEE 802.3/zlib) as rs485.js's crc32() — must
// match bit-for-bit, since FW_END's whole-image check only means anything
// if both sides compute the identical value. Runs one byte at a time (no
// lookup table) — only executes during an explicit firmware push, never on
// the hot poll path, so the extra cycles don't matter.
uint32_t crc32Update(uint32_t crc, const uint8_t* data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >> 1)) : (crc >> 1);
    }
  }
  return crc;
}

void handleFwBegin(uint8_t* payload, uint8_t len) {
  uint8_t ack[2] = { 0, 0 }; // stage=0, ok=0 unless proven otherwise below
  if (len < 8) { sendFrame(busAddress, CMD_FW_ACK, ack, 2); return; }
  memcpy(&fwExpectedSize, payload, 4);
  memcpy(&fwExpectedCrc, payload + 4, 4);
  fwBytesWritten = 0;
  fwCrcState = 0xFFFFFFFF;
  fwActive = Update.begin(fwExpectedSize);
  if (!fwActive) logLine("[RS485 Node] Firmware update rejected: Update.begin(%lu) failed.", (unsigned long)fwExpectedSize);
  ack[1] = fwActive ? 1 : 0;
  sendFrame(busAddress, CMD_FW_ACK, ack, 2);
}

void handleFwChunk(uint8_t* payload, uint8_t len) {
  uint16_t seq = 0;
  bool ok = false;
  if (len >= 2) {
    memcpy(&seq, payload, 2);
    if (fwActive) {
      uint8_t* data = payload + 2;
      uint8_t dataLen = len - 2;
      size_t written = Update.write(data, dataLen);
      ok = (written == dataLen);
      if (ok) {
        fwCrcState = crc32Update(fwCrcState, data, dataLen);
        fwBytesWritten += dataLen;
      } else {
        logLine("[RS485 Node] Firmware chunk write failed at seq %u.", seq);
        fwActive = false; // abort — FW_END will see the incomplete count and refuse to finalize
      }
    }
  }
  uint8_t ack[4] = { 1, (uint8_t)(ok ? 1 : 0), 0, 0 };
  memcpy(ack + 2, &seq, 2);
  sendFrame(busAddress, CMD_FW_ACK, ack, 4);
}

void handleFwEnd() {
  bool ok = false;
  if (fwActive && fwBytesWritten == fwExpectedSize) {
    uint32_t finalCrc = ~fwCrcState;
    if (finalCrc == fwExpectedCrc) {
      ok = Update.end(true);
      if (!ok) logLine("[RS485 Node] Firmware Update.end() failed verification.");
    } else {
      logLine("[RS485 Node] Firmware CRC mismatch (got %08lX, expected %08lX).", (unsigned long)finalCrc, (unsigned long)fwExpectedCrc);
    }
  } else {
    logLine("[RS485 Node] Firmware END with no active/incomplete transfer (%lu/%lu bytes).", (unsigned long)fwBytesWritten, (unsigned long)fwExpectedSize);
  }
  fwActive = false;

  uint8_t ack[2] = { 2, (uint8_t)(ok ? 1 : 0) };
  sendFrame(busAddress, CMD_FW_ACK, ack, 2);
  if (ok) {
    delay(100); // let the ACK's bytes actually clear the RS485 transceiver before this board disappears
    rp2040.reboot();
  }
}

void handleGetLog() {
  char text[LOG_LINE_MAX_LEN + 1];
  uint8_t payload[1 + LOG_LINE_MAX_LEN];
  if (popLogLine(text)) {
    uint8_t textLen = strlen(text);
    payload[0] = 1;
    memcpy(payload + 1, text, textLen);
    sendFrame(busAddress, CMD_LOG_LINE, payload, 1 + textLen);
  } else {
    payload[0] = 0;
    sendFrame(busAddress, CMD_LOG_LINE, payload, 1);
  }
}

void handleFrame(uint8_t addr, uint8_t cmd, uint8_t* payload, uint8_t len) {
  if (cmd == CMD_ASSIGN && addr == 0x00 && len == 9) {
    if (memcmp(payload, uniqueId, 8) == 0) {
      saveAddressToEEPROM(payload[8]);
      logLine("[RS485 Node] Assigned bus address %d", busAddress);
    }
    return;
  }
  if (busAddress == 0x00 || addr != busAddress) return; // not for us

  if (cmd == CMD_POLL) {
    sendReport();
  } else if (cmd == CMD_POLL_DIAL && HAS_DIAL) {
    bridgeDialPoll(payload, len);
  } else if (cmd == CMD_FW_BEGIN) {
    handleFwBegin(payload, len);
  } else if (cmd == CMD_FW_CHUNK) {
    handleFwChunk(payload, len);
  } else if (cmd == CMD_FW_END) {
    handleFwEnd();
  } else if (cmd == CMD_GET_LOG) {
    handleGetLog();
  } else if (cmd == CMD_SET_RELAY) {
    // No relay hardware on sensor nodes today — acknowledge so the master
    // doesn't retry, in case a future node type does carry one.
    sendFrame(busAddress, CMD_ACK, nullptr, 0);
  }
}

// ── Setup ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(RS485_DE_RE_PIN, OUTPUT);
  digitalWrite(RS485_DE_RE_PIN, LOW);
  Serial1.setTX(0);
  Serial1.setRX(1);
  Serial1.begin(BAUD_RATE);

  pico_unique_board_id_t idOut;
  pico_get_unique_board_id(&idOut);
  memcpy(uniqueId, idOut.id, 8);

  loadAddressFromEEPROM();

  Wire.begin();
  bmeReady = bme.begin();
  if (bmeReady) {
    bme.setTemperatureOversampling(BME680_OS_8X);
    bme.setHumidityOversampling(BME680_OS_2X);
    bme.setPressureOversampling(BME680_OS_4X);
    bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
    bme.setGasHeater(320, 150); // 320°C for 150ms, standard B  SEC-independent profile
  } else {
    logLine("[RS485 Node] BME680 not found.");
  }

  if (HAS_SCD41) {
    scd41Ready = scd41.begin();
    if (!scd41Ready) {
      logLine("[RS485 Node] SCD41 not found.");
    } else {
      // begin() only initializes the sensor — it doesn't start sampling.
      // Without this, readMeasurement() always returns false (no new data
      // ready) and CO2 never makes it into a REPORT.
      scd41.startPeriodicMeasurement();
    }
  }

  rp2040.wdt_begin(WATCHDOG_TIMEOUT_MS); // see WATCHDOG_TIMEOUT_MS's comment above

  logLine("[RS485 Node] Boot complete. Address: %d", busAddress);
}

// ── Main loop ─────────────────────────────────────────────────────
void loop() {
  rp2040.wdt_reset(); // pet every iteration — an un-pet watchdog force-reboots the chip, see WATCHDOG_TIMEOUT_MS
  pollSerial();

  if (busAddress == 0x00 && millis() - lastAnnounce >= ANNOUNCE_INTERVAL_MS) {
    lastAnnounce = millis();
    sendAnnounce();
  }
}
