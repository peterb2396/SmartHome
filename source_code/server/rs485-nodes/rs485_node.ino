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
 * ── Hardware per node ────────────────────────────────────────────
 *   RP2040 board (e.g. Pico, Pico W used purely for its RP2040 — no
 *     Wi-Fi needed for this node type)
 *   TTL-to-RS485 converter (e.g. MAX485/MAX3485 module) — DE and RE
 *     pins tied together on most breakout boards, driven from one GPIO
 *   LM2596 buck converter — steps the bus's 24V feed down to 5V for the
 *     RP2040's VSYS input (RP2040 logic itself is 3.3V, regulated on-board)
 *   Thermostat-zone nodes only: BME680 (temp/pressure/humidity/VOC) +
 *     SCD41 (CO2), both I2C
 *   Basement/attic monitor nodes: BME680 only, SCD41 omitted — set
 *     HAS_SCD41 to false below
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
 *   LM2596 OUT+ (5V)                     → RP2040 VSYS
 *   LM2596 OUT- / bus common             → RP2040 GND
 *
 * Bus address is assigned by the master (see ASSIGN in rs485.js) and
 * persisted to flash-emulated EEPROM — it survives power cycles. A node
 * ships with no address (0x00) and announces itself until configured from
 * the Console's "New Nodes" panel.
 */

#include <Wire.h>
#include <EEPROM.h>
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

const int RS485_DE_RE_PIN = 2;
const unsigned long BAUD_RATE = 9600;
const unsigned long ANNOUNCE_INTERVAL_MS = 5000;  // while unconfigured
const unsigned long EEPROM_SIZE = 8;
const int EEPROM_ADDR_BYTE = 0; // where the assigned bus address lives

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
const uint8_t CMD_ANNOUNCE = 0x81;
const uint8_t CMD_REPORT = 0x82;
const uint8_t CMD_ACK = 0x83;

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
    Serial.println("[RS485 Node] BME680 read failed, skipping this report's readings.");
  }

  if (HAS_SCD41 && scd41Ready && scd41.readMeasurement()) {
    appendReading(payload, offset, SENSOR_CO2, (float)scd41.getCO2());
  }

  sendFrame(busAddress, CMD_REPORT, payload, offset);
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

void pollSerial() {
  while (Serial1.available()) {
    if (rxLen < sizeof(rxBuf)) rxBuf[rxLen++] = Serial1.read();
    else rxLen = 0; // overflow, drop and resync on next SYNC byte
  }
  if (rxLen < 4) return;

  // Find sync byte
  uint8_t start = 0;
  while (start < rxLen && rxBuf[start] != SYNC) start++;
  if (start > 0) { memmove(rxBuf, rxBuf + start, rxLen - start); rxLen -= start; }
  if (rxLen < 4) return;

  uint8_t addr = rxBuf[1], cmd = rxBuf[2], len = rxBuf[3];
  if (rxLen < (uint16_t)(4 + len + 1)) return; // wait for full frame

  uint8_t crc = crc8(rxBuf + 1, 3 + len);
  uint8_t receivedCrc = rxBuf[4 + len];
  uint8_t* payload = rxBuf + 4;

  if (crc == receivedCrc) handleFrame(addr, cmd, payload, len);

  uint8_t frameLen = 4 + len + 1;
  memmove(rxBuf, rxBuf + frameLen, rxLen - frameLen);
  rxLen -= frameLen;
}

void handleFrame(uint8_t addr, uint8_t cmd, uint8_t* payload, uint8_t len) {
  if (cmd == CMD_ASSIGN && addr == 0x00 && len == 9) {
    if (memcmp(payload, uniqueId, 8) == 0) {
      saveAddressToEEPROM(payload[8]);
      Serial.printf("[RS485 Node] Assigned bus address %d\n", busAddress);
    }
    return;
  }
  if (busAddress == 0x00 || addr != busAddress) return; // not for us

  if (cmd == CMD_POLL) {
    sendReport();
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
    Serial.println("[RS485 Node] BME680 not found.");
  }

  if (HAS_SCD41) {
    scd41Ready = scd41.begin();
    if (!scd41Ready) {
      Serial.println("[RS485 Node] SCD41 not found.");
    } else {
      // begin() only initializes the sensor — it doesn't start sampling.
      // Without this, readMeasurement() always returns false (no new data
      // ready) and CO2 never makes it into a REPORT.
      scd41.startPeriodicMeasurement();
    }
  }

  Serial.printf("[RS485 Node] Boot complete. Address: %d\n", busAddress);
}

// ── Main loop ─────────────────────────────────────────────────────
void loop() {
  pollSerial();

  if (busAddress == 0x00 && millis() - lastAnnounce >= ANNOUNCE_INTERVAL_MS) {
    lastAnnounce = millis();
    sendAnnounce();
  }
}
