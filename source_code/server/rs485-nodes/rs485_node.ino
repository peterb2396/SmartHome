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
 * dial (if HAS_DIAL). The bridge is a pure byte-for-byte relay between
 * RS485 and I2C; this board never needs to understand the dial payload's
 * structure, just shuttle it. The dial itself carries NO RS485 logic at
 * all and doesn't need to know this bus exists — see that file's own
 * header.
 *
 * ── Hardware per node ────────────────────────────────────────────
 *   RP2040 board (e.g. Pico, Pico W used purely for its RP2040 — no
 *     Wi-Fi needed for this node type)
 *   TTL-to-RS485 converter (e.g. MAX485/MAX3485 module) — DE and RE
 *     pins tied together on most breakout boards, driven from one GPIO
 *   LM2596 buck converter — steps the bus's 24V feed down to 5V for the
 *     RP2040's VSYS input (RP2040 logic itself is 3.3V, regulated on-board)
 *     — this same 5V rail also feeds an attached dial, if any
 *   Thermostat-zone nodes: SCD41 only (CO2 + its own onboard RH — see
 *     readSensorsOnCore1()/SharedSensorState's comment on why humidity can
 *     come from either chip) — no BME680 on these. Set HAS_SCD41 to true,
 *     BME680 simply won't be found at setup1() and bmeReady stays false,
 *     no separate flag needed for "no BME680."
 *   Basement/attic monitor nodes only: BME680 (temp/pressure/humidity/
 *     VOC) + SCD41 (CO2) — the full sensor set lives here, not on the
 *     thermostat zones
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
 * exact API against your installed arduino-pico core version. Firmware
 * update handling stays entirely on core 0 (see the multicore section
 * below) — it's RS485-triggered and never touches I2C.
 *
 * ── Debug log relay (GET_LOG) ─────────────────────────────────────
 * logLine() (below) both Serial.prints (useful on the bench, unchanged)
 * and queues into a small ring buffer that GET_LOG drains one line per
 * poll — so field debug output (BME680/SCD41 not found, dial I2C errors,
 * etc.) shows up in the Console's log Terminal panel with no USB cable,
 * tagged by node name. Slow/round-robin on the master's side — debug
 * convenience riding along on production bus time, not control traffic.
 * Callable from either core (both log real events) — the ring buffer
 * itself is guarded by logLock since core 0 and core 1 can both call
 * logLine() concurrently; Serial.println() itself is NOT additionally
 * locked, so two near-simultaneous prints from both cores could in
 * principle interleave into one garbled line on the Serial Monitor — a
 * cosmetic risk only, not worth a second lock for.
 *
 * ── Health diagnostics (bench-only, Serial Monitor) ────────────────
 * printDiagnostics() dumps this node's own view of its health — uptime,
 * poll/report counts, CRC/resync/frame-stall counters, per-sensor I2C
 * failure streaks/read timings/staleness, free heap, loop-iteration gap,
 * core 1's heartbeat age, and boot/watchdog-reboot counts — straight to
 * Serial every single report cycle, deliberately NOT relayed through
 * GET_LOG (see diagPrint()'s comment on why). logBootDiagnostics()
 * (setup()) additionally tells you, on every boot, whether THIS boot was
 * caused by the watchdog catching a real hang — that IS relayed via
 * GET_LOG too, since a reboot is rare/important enough to be worth seeing
 * from the Console with no USB cable.
 *
 * ── The hang, and why this file is now split across both RP2040 cores ──
 * Real production evidence (basement node, 2026-08-15 23:14, and again
 * 2026-08-23 with full diagnostics running): a perfectly clean REPORT
 * arrives, then the NEXT poll gets zero bytes back — not garbled, not
 * partial, total silence — until physically power-cycled. The 2026-08-23
 * capture ran printDiagnostics() every cycle right up to the failure: EVERY
 * counter (CRC failures, resync drops, frame stalls, sensor failure
 * counts, free heap, loop-iteration gap) was completely flat and healthy
 * for 80+ minutes, then simply stopped mid-cycle with no warning in any of
 * them — and `bootCount`/`watchdogRebootCount` never advanced afterward,
 * confirming the hardware watchdog armed below did NOT recover this hang.
 * That rules out a gradual leak/slowdown and confirms the original theory:
 * a real, instantaneous, unrecoverable hang inside a blocking I2C call
 * (bme.performReading() / scd41.readMeasurement() — Wire transactions with
 * no timeout, a known RP2040 I2C peripheral failure mode on a glitched
 * bus) — AND that a single shared watchdog pet from inside the very same
 * loop() that hangs isn't a reliable enough backstop on its own.
 *
 * The fix: everything that touches I2C (BME680, SCD41, the dial bridge)
 * now runs exclusively on CORE 1, in setup1()/loop1(). CORE 0 keeps
 * setup()/loop() and owns everything RS485 (pollSerial/handleFrame/
 * sendFrame) plus EEPROM and firmware update — none of which ever call
 * into Wire. The two cores share a small struct (`shared`, guarded by
 * `sharedLock`, a pico-sdk critical_section_t — a real cross-core spinlock,
 * not just a flag) holding the latest sensor readings, diagnostics, and a
 * "core 1 is still alive" heartbeat. Core 0 never blocks on I2C to build a
 * REPORT — it just reads whatever core 1 last published, however many
 * milliseconds old that is (see printDiagnostics()'s staleMs fields). If
 * core 1 ever wedges inside a hung transaction, core 0 keeps answering
 * every RS485 poll with the last-known-good values (marked increasingly
 * stale) and keeps petting the watchdog for up to CORE1_STALL_THRESHOLD_MS
 * — then deliberately STOPS petting it, letting the same hardware watchdog
 * force a full reboot (the only thing that can actually clear a wedged I2C
 * peripheral) within a few more seconds. Net effect: a transient I2C
 * glitch (the common case) no longer takes the whole node offline at all —
 * RS485 never even hiccups — and a genuine unrecoverable wedge still
 * self-heals in single-digit seconds instead of "until physically
 * power-cycled," with printDiagnostics() now also surfacing core 1's own
 * heartbeat age so a repeat of this exact failure is unambiguous in the
 * log instead of a mystery.
 *
 * The dial bridge (bridgeDialPoll's old job) is inherently a two-way,
 * this-cycle's-payload exchange, not a simple cached value — see
 * requestDialBridge()/serviceDialFifoOnCore1() for how core 0 hands a
 * push payload to core 1 and gets a reply back over the RP2040's hardware
 * inter-core FIFO, bounded by DIAL_BRIDGE_TIMEOUT_MS so core 0 can never
 * block on it either; a timeout there is treated exactly like a dropped
 * RS485 frame (retried next ~20ms sweep), same tolerance the old
 * single-core version already had.
 *
 * UNVERIFIED AGAINST REAL HARDWARE, flagging clearly per this file's own
 * convention: (1) rp2040.fifo's exact push_nb()/pop_nb()/available() method
 * shapes, confirm against your installed arduino-pico core version; (2)
 * this relies on arduino-pico's documented core-1-starts-after-core-0's-
 * setup()-returns ordering so critical_section_init() below is guaranteed
 * to run before core 1 ever touches the lock — confirm this still holds on
 * your installed core version before trusting it blind.
 */

#include <Wire.h>
#include <EEPROM.h>
#include <Updater.h>
#include <stdarg.h>
#include <Adafruit_Sensor.h>
#include "Adafruit_BME680.h"
#include "pico/unique_id.h"
#include "hardware/watchdog.h"      // watchdog_caused_reboot() — see the boot diagnostics in setup()
#include "pico/critical_section.h"  // cross-core lock for `shared` and the log ring buffer — see this file's header

// ── Config — edit if your wiring differs ──────────────────────────
// A runtime bool, deliberately NOT gated behind #if — HAS_SCD41 is a real
// C++ variable, not a #define, so #if HAS_SCD41 would silently evaluate as
// #if 0 (the preprocessor treats any non-macro identifier as 0) and strip
// this entire feature out of every build regardless of this value. Learned
// that the hard way — see git history. The library/object below now always
// compile in; scd41 just never gets begin()'d or read when this is false.
const bool HAS_SCD41 = true; // false for basement/attic monitor nodes
const bool HAS_DIAL = false;  // false for zones with no wall dial attached

const int RS485_DE_RE_PIN = 2;
const unsigned long BAUD_RATE = 9600;
const unsigned long ANNOUNCE_INTERVAL_MS = 5000;  // while unconfigured
const unsigned long EEPROM_SIZE = 8;
const int EEPROM_ADDR_BYTE = 0;             // where the assigned bus address lives
const int EEPROM_BOOT_COUNT_BYTE = 1;       // wraps at 255 — see logBootDiagnostics()
const int EEPROM_WDT_REBOOT_COUNT_BYTE = 2; // wraps at 255 — count of boots caused by the watchdog specifically

// Explicit, matching this file's wiring doc (I2C0) — Serial1's TX/RX get
// the same explicit treatment via setTX()/setRX() in setup().
const int I2C_SDA_PIN = 4;
const int I2C_SCL_PIN = 5;

// See this file's header for the full story. 8000 is close to
// arduino-pico's hardware ceiling (~8388ms, a 24-bit counter).
const unsigned long WATCHDOG_TIMEOUT_MS = 8000;

// How long core 0 tolerates core 1 going quiet (no heartbeat update)
// before it deliberately stops petting the watchdog. Generous relative to
// a normal read cycle (BME680+SCD41 together normally finish in well under
// a second, and the heartbeat updates every loop1() iteration, more often
// than that) — this should only ever actually trip during a genuine wedge,
// never a slow-but-fine cycle. Kept below WATCHDOG_TIMEOUT_MS so the
// timeline is: core 1 wedges -> ~5s later core 0 stops petting -> ~8s after
// the LAST pet the chip reboots -> single-digit-second total recovery,
// vs. the "until physically power-cycled" this replaces.
const unsigned long CORE1_STALL_THRESHOLD_MS = 5000;

// Grace period after core 0's own boot before the check above is enforced
// at all — covers the window before core 1 has even had a chance to run
// setup1() (Wire.begin(), bme.begin(), scd41.begin()+startPeriodicMeasurement())
// once, which could plausibly take a second or two on its own.
const unsigned long CORE0_BOOT_GRACE_MS = 8000;

// Bounded wait for a core-1 dial exchange (see requestDialBridge()) — must
// stay comfortably under the MASTER's own DIAL_POLL_RESPONSE_TIMEOUT_MS
// (200ms, rs485.js) after accounting for RS485 turnaround, since a
// dial poll that times out here is otherwise indistinguishable from a
// dropped frame and just gets retried ~20ms later anyway.
const unsigned long DIAL_BRIDGE_TIMEOUT_MS = 60;

#include <SparkFun_SCD4x_Arduino_Library.h>
SCD4x scd41;

Adafruit_BME680 bme;

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
const uint8_t DIAL_PUSH_LEN = 27;  // must match rs485.js's POLL_DIAL payload size
const uint8_t DIAL_REPLY_LEN = 8;  // must match rs485.js's DIAL_STATE payload size

// Inter-core FIFO framing for the dial bridge — see requestDialBridge()/
// serviceDialFifoOnCore1(). Both directions are a fixed byte count every
// time (no variable-length framing needed): 1 sequence byte (detects a
// stale reply from an already-abandoned request) + the real payload,
// packed into whole 32-bit words (the RP2040 inter-core FIFO only moves
// words). 1+27=28B packs into exactly 7 words with zero padding; 1+8=9B
// needs 3 words (3B padding, unused).
const int DIAL_REQ_WORDS = (1 + DIAL_PUSH_LEN + 3) / 4;
const int DIAL_REPLY_WORDS = (1 + DIAL_REPLY_LEN + 3) / 4;

const uint8_t SENSOR_TEMPERATURE = 0x01;
const uint8_t SENSOR_HUMIDITY = 0x02;
const uint8_t SENSOR_PRESSURE = 0x03;
const uint8_t SENSOR_VOC = 0x04;
const uint8_t SENSOR_CO2 = 0x05;

uint8_t busAddress = 0x00; // 0x00 = unconfigured — core 0 only
uint8_t uniqueId[8];
unsigned long lastAnnounce = 0;

// ── Cross-core shared state ─────────────────────────────────────────
// Everything core 1 (I2C) publishes for core 0 (RS485) to read. Copied in
///out as a whole struct under sharedLock — cheap (it's all plain fields,
// no pointers), and simplest to reason about correctly: exactly one lock,
// held only ever for a plain memory copy, never around anything that
// could itself block. See this file's header for the full design.
struct SharedSensorState {
  float tempF = 0, humidity = 0, pressureHpa = 0, voc = 0, co2 = 0;
  bool bmeReady = false, scd41Ready = false; // sensor FOUND at setup1() — never changes after
  bool bmeOk = false, co2Ok = false;         // did the LAST read attempt succeed
  // Humidity is tracked separately from bmeOk on purpose — it can come
  // from EITHER chip (SCD4x measures its own onboard RH for CO2
  // compensation, and exposes it via getHumidity(), same as BME680 does)
  // — see readSensorsOnCore1() for which one actually wins on a given
  // node. Zones with no BME680 at all (most of them — see envSensors.js's
  // header on the server) still get a real RH reading this way, not just
  // co2.
  bool humidityOk = false;
  unsigned long lastGoodHumidityAtMs = 0;
  unsigned long lastGoodBmeAtMs = 0;         // core 1's millis() at its last successful BME680 read
  unsigned long lastGoodCo2AtMs = 0;         // core 1's millis() at its last successful SCD41 read

  unsigned long bmeFailTotal = 0, bmeFailStreak = 0, lastBmeReadMs = 0;
  unsigned long scd41FailTotal = 0, scd41FailStreak = 0, lastScd41ReadMs = 0;
  unsigned long dialI2cFailTotal = 0;
  unsigned long i2cRecoveries = 0; // see i2cBusRecovery()

  unsigned long core1HeartbeatMs = 0; // core 1's own millis(), updated every loop1() iteration — see loop()
  // Core 1's OWN measurement of its longest iteration-to-iteration gap —
  // see loop1(). Exists specifically to answer "is core 1 itself actually
  // getting slower over days of uptime, or is core1HeartbeatAgoMs's slow
  // climb (seen in the field) just sampling bias from core 0 occasionally
  // catching core 1 mid-sensor-read?" Since SENSOR_READ_INTERVAL_MS
  // (2000ms) divides POLL_INTERVAL_MS (10000ms, rs485.js) exactly, core
  // 0's ~10s report cadence and core 1's ~2s read cadence can drift in and
  // out of phase against each other over long uptimes — core0's OWN
  // sampled "how long ago" number can slowly walk toward the worst-case
  // moment in that cycle (right as a read begins) without core 1 having
  // gotten any slower at all. This field is measured directly ON core 1,
  // with no external sampling involved, so it tells the two apart for
  // real: it should stay pinned at whatever readSensorsOnCore1() actually
  // takes (see lastBmeReadMs/lastScd41ReadMs) if core 1 is healthy, and
  // only genuinely climb over time if core 1 itself is slowing down.
  unsigned long maxLoop1GapMs = 0;
};
SharedSensorState shared;
critical_section_t sharedLock;
critical_section_t logLock; // guards logBuffer/logHead/logCount only — see logLine()/popLogLine()

// ── Diagnostics owned by core 0 (RS485-side counters) ───────────────
uint8_t bootCount = 0;           // persisted — see logBootDiagnostics()
uint8_t watchdogRebootCount = 0; // persisted — see logBootDiagnostics()
bool lastRebootWasWatchdog = false;

unsigned long pollsReceived = 0;   // CMD_POLL frames addressed to us
unsigned long reportsSent = 0;     // successful buildAndSendReport() calls
unsigned long crcFailures = 0;     // frames with a bad checksum (pollSerial())
unsigned long resyncDrops = 0;     // bytes dropped while resyncing on SYNC (pollSerial())
unsigned long frameStalls = 0;     // partial frames abandoned after FRAME_STALL_MS
unsigned long maxLoopGapMs = 0;    // longest gap ever seen between two loop() iterations
unsigned long lastLoopAt = 0;
unsigned long lastPollAt = 0;      // millis() of the last CMD_POLL received, addressed to us
unsigned long lastPollGapMs = 0;   // elapsed time between the two most recent polls — see handleFrame()
unsigned long bootAtMs = 0;        // millis() at the top of setup() — see CORE0_BOOT_GRACE_MS
uint8_t dialReqSeq = 0;            // see requestDialBridge()

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

// Callable from either core — see this file's header on the locking here.
void logLine(const char* fmt, ...) {
  char formatted[96];
  va_list args;
  va_start(args, fmt);
  vsnprintf(formatted, sizeof(formatted), fmt, args);
  va_end(args);
  Serial.println(formatted);

  critical_section_enter_blocking(&logLock);
  // Ring buffer: write at the next free slot, or — once full — overwrite
  // the oldest and advance logHead past it (drop it), rather than block
  // or grow. (logHead+logCount)%N lands exactly on logHead once full,
  // which is what makes the overwrite-oldest behavior fall out for free.
  uint8_t writeIdx = (logHead + logCount) % LOG_BUFFER_LINES;
  strncpy(logBuffer[writeIdx], formatted, LOG_LINE_MAX_LEN);
  logBuffer[writeIdx][LOG_LINE_MAX_LEN] = '\0';
  if (logCount < LOG_BUFFER_LINES) logCount++;
  else logHead = (logHead + 1) % LOG_BUFFER_LINES;
  critical_section_exit(&logLock);
}

// Fills out[LOG_LINE_MAX_LEN+1] and returns true if a line was queued.
// Only ever called from core 0 (handleGetLog()), but still locked since
// writers can come from either core.
bool popLogLine(char* out) {
  critical_section_enter_blocking(&logLock);
  bool got = logCount > 0;
  if (got) {
    strncpy(out, logBuffer[logHead], LOG_LINE_MAX_LEN + 1);
    logHead = (logHead + 1) % LOG_BUFFER_LINES;
    logCount--;
  }
  critical_section_exit(&logLock);
  return got;
}

// Serial-only, deliberately NOT routed through logLine()'s ring buffer.
// printDiagnostics() below calls this several times every single report
// cycle (once per ~10s poll) — through logLine() that would flood the
// 8-line GET_LOG ring buffer (drained at ~1 line/3s over RS485, see this
// file's header) and crowd out the actually-rare, actually-important
// events (sensor failures, CRC mismatches, bus recovery attempts) that
// GET_LOG exists to surface to the Console with no USB cable. This is for
// the bench: a live Serial Monitor connection, exactly what this feature
// was asked for — a full trail of the node's own health right up to the
// last line it ever managed to print before going silent.
void diagPrint(const char* fmt, ...) {
  char formatted[130];
  va_list args;
  va_start(args, fmt);
  vsnprintf(formatted, sizeof(formatted), fmt, args);
  va_end(args);
  Serial.println(formatted);
}

// ── Half-duplex send: assert DE/RE, write, wait for the line to clear ─
// Core 0 only — see this file's header.
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
  // Real production evidence: this used to be Serial1.flush(), which waits
  // on the UART's own TX-empty HARDWARE status flag. If that flag ever
  // fails to assert (a UART peripheral glitch — plausible on the same
  // noisy bus that already causes I2C hangs), flush() spins forever, the
  // digitalWrite(...LOW) below it never runs, DE/RE stays latched in
  // transmit mode permanently, and this node's receiver is now
  // permanently disabled — total, silent, unrecoverable RS485 deafness
  // with zero CRC/resync/frame-stall trace (nothing garbled ever arrives;
  // nothing arrives at all), and NO reboot, since this is a hardware
  // status-register spin, not a true infinite instruction loop the
  // watchdog reliably interrupts. Confirmed against a real 16+ minute
  // outage that never self-recovered. Fixed by never touching that flag
  // at all: a delay computed from the actual frame length and baud rate
  // is pure arithmetic against a timer — it cannot hang regardless of
  // what the UART peripheral's internal state does, and DE/RE dropping
  // back to receive is now unconditional.
  uint8_t frameLen = 4 + len + 1; // sync+addr+cmd+len header (4) + payload + crc
  delayMicroseconds((unsigned long)frameLen * 1200UL); // ~1.04ms/byte at 9600 baud (10 bit-times/byte), ~15% margin
  digitalWrite(RS485_DE_RE_PIN, LOW); // back to receive — unconditional, never gated on a hardware flag
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

// ═══════════════════════════════════════════════════════════════════
// ── CORE 1 — owns ALL I2C: BME680, SCD41, the dial bridge ───────────
// Nothing below this point that touches Wire/bme/scd41/DIAL_I2C_ADDR
// runs anywhere except loop1()/setup1() and the functions they call. See
// this file's header for why.
// ═══════════════════════════════════════════════════════════════════

const unsigned long I2C_FAIL_RECOVERY_THRESHOLD = 3; // consecutive real (non-hang) failures before attempting a bus recovery
float gasBaselineOhms = 0; // learned on first few readings, for the VOC heuristic — core 1 only

// Manual SCL/SDA toggling to release a slave stuck holding the I2C bus low
// mid-transaction — the standard software recovery: up to 9 clock pulses
// (enough for a slave to finish clocking out whatever byte it's stuck on
// and release SDA), then a manually-issued STOP condition. No true
// open-drain pinMode needed — SCL/SDA are only ever actively driven LOW;
// "high" is just releasing the pin to INPUT_PULLUP and letting the bus's
// own (required) pull-up resistors do the rest. This can only help the
// "reads are failing/erroring but the call still RETURNS" case — it
// cannot rescue a call that's already blocked forever inside the Wire
// library; only the core-1-stall-triggered watchdog reboot can recover
// from that now. Logged unconditionally either way — how often this fires
// is itself useful evidence.
void i2cSetSCL(bool high) {
  if (high) pinMode(I2C_SCL_PIN, INPUT_PULLUP);
  else { pinMode(I2C_SCL_PIN, OUTPUT); digitalWrite(I2C_SCL_PIN, LOW); }
}
void i2cSetSDA(bool high) {
  if (high) pinMode(I2C_SDA_PIN, INPUT_PULLUP);
  else { pinMode(I2C_SDA_PIN, OUTPUT); digitalWrite(I2C_SDA_PIN, LOW); }
}
void i2cBusRecovery() {
  unsigned long attemptNum;
  critical_section_enter_blocking(&sharedLock);
  shared.i2cRecoveries++;
  attemptNum = shared.i2cRecoveries;
  critical_section_exit(&sharedLock);

  logLine("[RS485 Node] I2C bus recovery attempt #%lu starting...", attemptNum);
  Wire.end();
  i2cSetSDA(true);
  i2cSetSCL(true);
  delayMicroseconds(10);

  int pulses = 0;
  while (pulses < 9 && digitalRead(I2C_SDA_PIN) == LOW) {
    i2cSetSCL(false);
    delayMicroseconds(5);
    i2cSetSCL(true);
    delayMicroseconds(5);
    pulses++;
  }

  // Manual STOP: SDA low->high while SCL is high.
  i2cSetSDA(false);
  delayMicroseconds(5);
  i2cSetSCL(true);
  delayMicroseconds(5);
  i2cSetSDA(true);
  delayMicroseconds(5);

  Wire.setSDA(I2C_SDA_PIN);
  Wire.setSCL(I2C_SCL_PIN);
  Wire.begin();
  logLine("[RS485 Node] I2C bus recovery #%lu done (%d clock pulses, SDA %s after)",
    attemptNum, pulses, digitalRead(I2C_SDA_PIN) == HIGH ? "released" : "STILL STUCK LOW");
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

// The actual blocking I2C work — this and only this can ever wedge, and
// wedging it only ever freezes core 1 (see this file's header). Runs on
// its own schedule (SENSOR_READ_INTERVAL_MS), not per-RS485-poll — core 0
// just serves whatever's freshest whenever a REPORT is actually requested.
const unsigned long SENSOR_READ_INTERVAL_MS = 2000;
unsigned long lastSensorReadAttempt = 0;

void readSensorsOnCore1() {
  bool bmeReadyLocal, scd41ReadyLocal;
  critical_section_enter_blocking(&sharedLock);
  bmeReadyLocal = shared.bmeReady;
  scd41ReadyLocal = shared.scd41Ready;
  critical_section_exit(&sharedLock);

  bool bmeOk = false;
  unsigned long bmeMs = 0;
  float tempF = 0, humidity = 0, pressureHpa = 0, voc = 0;
  if (bmeReadyLocal) {
    unsigned long start = millis();
    bmeOk = bme.performReading();
    bmeMs = millis() - start;
    if (bmeOk) {
      tempF = bme.temperature * 9.0 / 5.0 + 32.0;
      humidity = bme.humidity;
      pressureHpa = bme.pressure / 100.0;
      voc = vocHeuristic(bme.gas_resistance);
    }
  }

  // The SCD41 only produces a NEW measurement roughly every 5 seconds
  // (its own internal periodic-measurement cadence, started once in
  // setup1()) — it does not mean anything went wrong if we happen to ask
  // again before that's elapsed. getDataReadyStatus() is a fast (~1ms)
  // status-register check with no data transfer; only call the real
  // readMeasurement() once it says yes, so a `false` from readMeasurement()
  // itself always means an ACTUAL read failure, never "just not yet" —
  // which is also what a 1ms-and-done cycle turned out to mean before this
  // fix: readMeasurement() itself was returning false near-instantly for
  // "not ready," and every one of those was being miscounted as a failure.
  bool co2DataReady = false, co2Ok = false;
  unsigned long scdMs = 0;
  float co2 = 0, scdHumidity = 0;
  if (HAS_SCD41 && scd41ReadyLocal) {
    co2DataReady = scd41.getDataReadyStatus();
    if (co2DataReady) {
      unsigned long start = millis();
      co2Ok = scd41.readMeasurement();
      scdMs = millis() - start;
      // getHumidity() reads back the SAME measurement readMeasurement()
      // just cached (the SCD4x measures its own onboard RH internally,
      // for its own CO2 compensation) — no extra I2C transaction, so this
      // is "free" alongside the CO2 read. Most zones have no BME680 at
      // all (see envSensors.js's header on the server) — this is their
      // ONLY source of a real humidity reading, not a fallback for a
      // "nice to have."
      if (co2Ok) { co2 = (float)scd41.getCO2(); scdHumidity = scd41.getHumidity(); }
    }
  }

  unsigned long now = millis();
  unsigned long bmeFailStreakNow = 0, scd41FailStreakNow = 0;
  critical_section_enter_blocking(&sharedLock);
  if (bmeReadyLocal) {
    shared.lastBmeReadMs = bmeMs;
    if (bmeOk) {
      shared.bmeOk = true;
      shared.bmeFailStreak = 0;
      shared.tempF = tempF; shared.pressureHpa = pressureHpa; shared.voc = voc;
      shared.lastGoodBmeAtMs = now;
      // BME680 wins whenever this node actually has one — it's the more
      // dedicated humidity sensor of the two chips (see readEnvironment()
      // never combining both; this is where that single-source guarantee
      // actually gets decided).
      shared.humidity = humidity;
      shared.humidityOk = true;
      shared.lastGoodHumidityAtMs = now;
    } else {
      shared.bmeOk = false;
      shared.bmeFailTotal++;
      shared.bmeFailStreak++;
    }
    bmeFailStreakNow = shared.bmeFailStreak;
  }
  // No data-ready yet is NOT a failure — leave co2Ok/streak/counters
  // completely untouched (the last known-good value, and its staleness
  // clock, just keep holding until a real new attempt actually happens).
  if (HAS_SCD41 && scd41ReadyLocal && co2DataReady) {
    shared.lastScd41ReadMs = scdMs;
    if (co2Ok) {
      shared.co2Ok = true;
      shared.scd41FailStreak = 0;
      shared.co2 = co2;
      shared.lastGoodCo2AtMs = now;
      // Only when this node has no BME680 at all — see above.
      if (!bmeReadyLocal) {
        shared.humidity = scdHumidity;
        shared.humidityOk = true;
        shared.lastGoodHumidityAtMs = now;
      }
    } else {
      shared.co2Ok = false;
      shared.scd41FailTotal++;
      shared.scd41FailStreak++;
    }
  }
  scd41FailStreakNow = shared.scd41FailStreak;
  critical_section_exit(&sharedLock);

  if (bmeReadyLocal && !bmeOk) logLine("[RS485 Node] BME680 read failed (%lums, streak %lu)", bmeMs, bmeFailStreakNow);
  if (HAS_SCD41 && scd41ReadyLocal && co2DataReady && !co2Ok) logLine("[RS485 Node] SCD41 read failed (%lums, streak %lu)", scdMs, scd41FailStreakNow);

  if (bmeFailStreakNow >= I2C_FAIL_RECOVERY_THRESHOLD || scd41FailStreakNow >= I2C_FAIL_RECOVERY_THRESHOLD) i2cBusRecovery();
}

// The real I2C exchange with the dial — unchanged from the original
// single-core version except it no longer calls sendFrame() itself (core 1
// never touches RS485); it just fills replyOut and returns whether it
// worked. See serviceDialFifoOnCore1() for how this gets wired to core 0.
bool doDialI2cExchange(uint8_t* pushPayload, uint8_t pushLen, uint8_t* replyOut) {
  Wire.beginTransmission(DIAL_I2C_ADDR);
  Wire.write(pushPayload, pushLen);
  uint8_t writeResult = Wire.endTransmission();
  if (writeResult != 0) {
    unsigned long fails;
    critical_section_enter_blocking(&sharedLock);
    fails = ++shared.dialI2cFailTotal;
    critical_section_exit(&sharedLock);
    logLine("[RS485 Node] Dial I2C write failed (code %d, total failures %lu)", writeResult, fails);
    if (fails % I2C_FAIL_RECOVERY_THRESHOLD == 0) i2cBusRecovery();
    return false;
  }

  uint8_t got = Wire.requestFrom(DIAL_I2C_ADDR, DIAL_REPLY_LEN);
  if (got < DIAL_REPLY_LEN) {
    unsigned long fails;
    critical_section_enter_blocking(&sharedLock);
    fails = ++shared.dialI2cFailTotal;
    critical_section_exit(&sharedLock);
    logLine("[RS485 Node] Dial I2C read short (%d/%d bytes, total failures %lu)", got, DIAL_REPLY_LEN, fails);
    while (Wire.available()) Wire.read(); // drain whatever partial reply there was
    if (fails % I2C_FAIL_RECOVERY_THRESHOLD == 0) i2cBusRecovery();
    return false;
  }
  for (uint8_t i = 0; i < DIAL_REPLY_LEN; i++) replyOut[i] = Wire.read();
  return true;
}

// Drains a complete dial-bridge request from core 0 (if one is fully
// queued — see requestDialBridge()'s framing) and pushes the reply back.
// If doDialI2cExchange() fails, no reply is pushed at all — core 0's
// bounded wait simply times out, indistinguishable from a dropped RS485
// frame, exactly like the original single-core bridgeDialPoll()'s own
// documented behavior.
void serviceDialFifoOnCore1() {
  if (!HAS_DIAL) return;
  if (rp2040.fifo.available() < DIAL_REQ_WORDS) return; // no complete request waiting yet

  uint32_t words[DIAL_REQ_WORDS];
  for (int i = 0; i < DIAL_REQ_WORDS; i++) rp2040.fifo.pop_nb(&words[i]); // available() already confirmed all of these are there

  uint8_t framed[DIAL_REQ_WORDS * 4];
  memcpy(framed, words, sizeof(framed));
  uint8_t seq = framed[0];
  uint8_t* pushPayload = framed + 1;

  uint8_t reply[DIAL_REPLY_LEN];
  if (!doDialI2cExchange(pushPayload, DIAL_PUSH_LEN, reply)) return;

  uint8_t framedReply[DIAL_REPLY_WORDS * 4] = {0};
  framedReply[0] = seq;
  memcpy(framedReply + 1, reply, DIAL_REPLY_LEN);
  uint32_t replyWords[DIAL_REPLY_WORDS];
  memcpy(replyWords, framedReply, sizeof(replyWords));
  for (int i = 0; i < DIAL_REPLY_WORDS; i++) rp2040.fifo.push_nb(replyWords[i]);
}

// ── Core 1 entry points (arduino-pico multicore) ────────────────────
void setup1() {
  Wire.setSDA(I2C_SDA_PIN);
  Wire.setSCL(I2C_SCL_PIN);
  Wire.begin();

  bool bmeOk = bme.begin();
  if (bmeOk) {
    bme.setTemperatureOversampling(BME680_OS_8X);
    bme.setHumidityOversampling(BME680_OS_2X);
    bme.setPressureOversampling(BME680_OS_4X);
    bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
    bme.setGasHeater(320, 150); // 320°C for 150ms, standard BSEC-independent profile
  } else {
    logLine("[RS485 Node] BME680 not found.");
  }

  bool scdOk = false;
  if (HAS_SCD41) {
    scdOk = scd41.begin();
    if (!scdOk) {
      logLine("[RS485 Node] SCD41 not found.");
    } else {
      // begin() only initializes the sensor — it doesn't start sampling.
      // Without this, readMeasurement() always returns false (no new data
      // ready) and CO2 never makes it into a REPORT.
      scd41.startPeriodicMeasurement();
    }
  }

  critical_section_enter_blocking(&sharedLock);
  shared.bmeReady = bmeOk;
  shared.scd41Ready = scdOk;
  shared.core1HeartbeatMs = millis();
  critical_section_exit(&sharedLock);
}

unsigned long lastLoop1At = 0; // core 1 local — see maxLoop1GapMs's comment on SharedSensorState

void loop1() {
  // Measured BEFORE the heartbeat write below, using the same millis()
  // call, so this and shared.core1HeartbeatMs always agree on "now" for a
  // given iteration — see SharedSensorState's maxLoop1GapMs comment for
  // why this exists (distinguishing a real core 1 slowdown from core 0
  // just occasionally sampling mid-read).
  unsigned long now1 = millis();
  unsigned long loop1Gap = lastLoop1At == 0 ? 0 : now1 - lastLoop1At;
  lastLoop1At = now1;

  // Heartbeat FIRST, unconditionally, before anything that could block —
  // this is what core 0 watches to decide whether it's still safe to keep
  // petting the watchdog (see loop()). If a read hangs right after this,
  // the heartbeat simply stops advancing from here, which is exactly the
  // signal core 0 needs.
  critical_section_enter_blocking(&sharedLock);
  shared.core1HeartbeatMs = now1;
  if (loop1Gap > shared.maxLoop1GapMs) shared.maxLoop1GapMs = loop1Gap;
  critical_section_exit(&sharedLock);

  // Dial exchanges are latency-sensitive (the dial polls every ~20ms) and
  // fast — service any pending one before considering a sensor read, so a
  // slow sensor cycle doesn't stack dial latency up behind it.
  serviceDialFifoOnCore1();

  if (millis() - lastSensorReadAttempt >= SENSOR_READ_INTERVAL_MS) {
    lastSensorReadAttempt = millis();
    readSensorsOnCore1();
  }
}

// ═══════════════════════════════════════════════════════════════════
// ── CORE 0 — owns ALL RS485: pollSerial/handleFrame/sendFrame, plus
// EEPROM and firmware update. NEVER calls into Wire/bme/scd41/DIAL_I2C_ADDR
// — see this file's header.
// ═══════════════════════════════════════════════════════════════════

// Bounded hand-off to core 1 for the actual dial I2C exchange — see this
// file's header on why ALL I2C, dial included, now lives exclusively on
// core 1. Blocks core 0 for at most DIAL_BRIDGE_TIMEOUT_MS, never
// indefinitely: if core 1 is mid-hang (or its inbox is backed up) this
// just gives up and returns false, which the caller already treats
// exactly like a dropped frame (no RS485 reply this cycle, retried next
// sweep) — so a core-1 stall degrades the DIAL's responsiveness, never
// core 0's/the rest of the bus's.
bool requestDialBridge(uint8_t* pushPayload, uint8_t pushLen, uint8_t* replyOut) {
  if (pushLen != DIAL_PUSH_LEN) return false;

  // Drain anything stale left in OUR inbox from a previous timed-out
  // exchange — otherwise a late reply from THAT one could be misread as
  // this one's (the sequence-byte check below is the second, belt-and-
  // suspenders layer of the same protection).
  while (rp2040.fifo.available()) { uint32_t junk; rp2040.fifo.pop_nb(&junk); }

  dialReqSeq++; // wraps at 256 — only needs to differ from the last one
  uint8_t framed[DIAL_REQ_WORDS * 4];
  framed[0] = dialReqSeq;
  memcpy(framed + 1, pushPayload, pushLen);

  uint32_t words[DIAL_REQ_WORDS];
  memcpy(words, framed, sizeof(framed));
  for (int i = 0; i < DIAL_REQ_WORDS; i++) {
    if (!rp2040.fifo.push_nb(words[i])) return false; // core 1's inbox is backed up — bail, don't wait
  }

  unsigned long start = millis();
  uint32_t replyWords[DIAL_REPLY_WORDS];
  int got = 0;
  while (got < DIAL_REPLY_WORDS && millis() - start < DIAL_BRIDGE_TIMEOUT_MS) {
    uint32_t w;
    if (rp2040.fifo.pop_nb(&w)) replyWords[got++] = w;
  }
  if (got < DIAL_REPLY_WORDS) return false; // core 1 never answered in time

  uint8_t framedReply[DIAL_REPLY_WORDS * 4];
  memcpy(framedReply, replyWords, sizeof(framedReply));
  if (framedReply[0] != dialReqSeq) return false; // stale reply from a previous, already-abandoned request
  memcpy(replyOut, framedReply + 1, DIAL_REPLY_LEN);
  return true;
}

// Builds and sends a REPORT from whatever core 1 last published — never
// touches I2C directly, so this can never block. A reading is included
// only if the LAST attempt on core 1 actually succeeded (shared.bmeOk/
// co2Ok) — same semantics as the original single-core version (a failed
// read just omits that reading for the cycle; sensorStore.js's own
// staleness tracking handles the rest), just decoupled from whether a
// fresh read happens to land exactly during this specific report.
void buildAndSendReport() {
  uint8_t payload[5 * 5]; // up to 5 readings
  uint8_t offset = 0;

  SharedSensorState s;
  critical_section_enter_blocking(&sharedLock);
  s = shared; // POD struct copy — cheap, bounded, never blocks
  critical_section_exit(&sharedLock);

  if (s.bmeReady && s.bmeOk) {
    appendReading(payload, offset, SENSOR_TEMPERATURE, s.tempF);
    appendReading(payload, offset, SENSOR_PRESSURE, s.pressureHpa);
    appendReading(payload, offset, SENSOR_VOC, s.voc);
  }
  // Independent of bmeOk on purpose — humidity can come from either chip,
  // see readSensorsOnCore1()/SharedSensorState's comment. Still capped at
  // 5 readings total either way: BME680 present -> temp+pressure+voc (3)
  // + humidity (1) + co2 (1) = 5; BME680 absent -> humidity (1) + co2 (1).
  if (s.humidityOk) {
    appendReading(payload, offset, SENSOR_HUMIDITY, s.humidity);
  }
  if (HAS_SCD41 && s.scd41Ready && s.co2Ok) {
    appendReading(payload, offset, SENSOR_CO2, s.co2);
  }

  sendFrame(busAddress, CMD_REPORT, payload, offset);
  reportsSent++;
  printDiagnostics();
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
// master, even though it's still receiving them electrically. Two checks:
// an implausible len drops the sync byte immediately, a plausible-but-
// never-completing one times out.
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
    resyncDrops++;
    return;
  }

  if (rxLen < (uint16_t)(4 + len + 1)) { // wait for full frame
    if (!awaitingFrame) { awaitingFrame = true; awaitingFrameSince = millis(); }
    else if (millis() - awaitingFrameSince > FRAME_STALL_MS) {
      memmove(rxBuf, rxBuf + 1, rxLen - 1);
      rxLen -= 1;
      awaitingFrame = false;
      frameStalls++;
      logLine("[RS485 Node] Frame stall — dropped 1 byte to resync (stall #%lu)", frameStalls);
    }
    return;
  }
  awaitingFrame = false;

  uint8_t addr = rxBuf[1], cmd = rxBuf[2];
  uint8_t crc = crc8(rxBuf + 1, 3 + len);
  uint8_t receivedCrc = rxBuf[4 + len];
  uint8_t* payload = rxBuf + 4;

  if (crc == receivedCrc) {
    handleFrame(addr, cmd, payload, len);
  } else {
    crcFailures++;
    logLine("[RS485 Node] CRC mismatch (got %02X expected %02X, cmd=%02X len=%d) — dropped (failure #%lu)", receivedCrc, crc, cmd, len, crcFailures);
  }

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
    unsigned long now = millis();
    if (lastPollAt != 0) lastPollGapMs = now - lastPollAt; // "how long since the poll before this one" — printDiagnostics() runs synchronously right after this, so "time since last poll" would always read ~0; the GAP between polls is the useful signal
    lastPollAt = now;
    pollsReceived++;
    buildAndSendReport();
  } else if (cmd == CMD_POLL_DIAL && HAS_DIAL) {
    uint8_t reply[DIAL_REPLY_LEN];
    if (requestDialBridge(payload, len, reply)) {
      sendFrame(busAddress, CMD_DIAL_STATE, reply, DIAL_REPLY_LEN);
    }
    // else: no reply this cycle — indistinguishable from a dropped frame,
    // master retries next sweep (~20ms later).
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

// ── Diagnostics ──────────────────────────────────────────────────
// Called once from setup(), right after loadAddressFromEEPROM() (which has
// already done EEPROM.begin()). Answers the two questions that matter most
// when this node's been reported dead: did it actually reboot (and how
// many times total, across power cycles — bootCount survives power loss,
// unlike the watchdog peripheral's own scratch registers, which only
// survive a watchdog-triggered reset specifically), and was THIS boot
// caused by the watchdog catching a hang.
void logBootDiagnostics() {
  bootCount = EEPROM.read(EEPROM_BOOT_COUNT_BYTE);
  if (bootCount == 0xFF) bootCount = 0; // erased flash reads as 0xFF
  bootCount++;
  EEPROM.write(EEPROM_BOOT_COUNT_BYTE, bootCount);

  watchdogRebootCount = EEPROM.read(EEPROM_WDT_REBOOT_COUNT_BYTE);
  if (watchdogRebootCount == 0xFF) watchdogRebootCount = 0;
  lastRebootWasWatchdog = watchdog_caused_reboot();
  if (lastRebootWasWatchdog) {
    watchdogRebootCount++;
    EEPROM.write(EEPROM_WDT_REBOOT_COUNT_BYTE, watchdogRebootCount);
  }
  EEPROM.commit();

  logLine("[RS485 Node] ==== BOOT #%u (lifetime, survives power loss) ====", bootCount);
  logLine("[RS485 Node] Reset cause: %s", lastRebootWasWatchdog ? "WATCHDOG (this node was HUNG)" : "power-on / manual / other");
  logLine("[RS485 Node] Watchdog-caused reboots so far: %u of %u total boots", watchdogRebootCount, bootCount);
}

// The per-report-cycle dump this whole feature was asked for — see
// diagPrint()'s comment on why this is Serial-only, not relayed.
void printDiagnostics() {
  SharedSensorState s;
  critical_section_enter_blocking(&sharedLock);
  s = shared;
  critical_section_exit(&sharedLock);

  unsigned long now = millis();
  diagPrint("[RS485 Node] diag: up=%lus addr=%d polls=%lu reports=%lu lastPollGapMs=%lu",
    now / 1000, busAddress, pollsReceived, reportsSent, lastPollGapMs);
  diagPrint("[RS485 Node] diag: freeHeap=%lu totalHeap=%lu crcFail=%lu resyncDrops=%lu frameStalls=%lu",
    (unsigned long)rp2040.getFreeHeap(), (unsigned long)rp2040.getTotalHeap(), crcFailures, resyncDrops, frameStalls);
  diagPrint("[RS485 Node] diag: bme(ready=%d ok=%d fail=%lu streak=%lu lastReadMs=%lu staleMs=%lu)",
    s.bmeReady, s.bmeOk, s.bmeFailTotal, s.bmeFailStreak, s.lastBmeReadMs,
    s.lastGoodBmeAtMs ? now - s.lastGoodBmeAtMs : 0);
  diagPrint("[RS485 Node] diag: scd41(ready=%d ok=%d fail=%lu streak=%lu lastReadMs=%lu staleMs=%lu)",
    s.scd41Ready, s.co2Ok, s.scd41FailTotal, s.scd41FailStreak, s.lastScd41ReadMs,
    s.lastGoodCo2AtMs ? now - s.lastGoodCo2AtMs : 0);
  // core1HeartbeatAgoMs is the single most important line if a core 1 hang
  // ever recurs: a large/growing value here IS core 1 wedged, in real
  // time, well before CORE1_STALL_THRESHOLD_MS forces a reboot. It's also
  // expected to drift SLOWLY over many days even when core 1 is perfectly
  // healthy — see SharedSensorState's maxLoop1GapMs comment for why —
  // which is what maxLoop1GapMs is for: measured directly on core 1 with
  // no external sampling involved, it should stay pinned at whatever a
  // real sensor read takes (see bme/scd41's own lastReadMs above) for the
  // life of this node. If THIS number is ever the one climbing, core 1 is
  // genuinely slowing down; if it stays flat while core1HeartbeatAgoMs
  // above keeps drifting, that drift is harmless sampling-phase noise.
  diagPrint("[RS485 Node] diag: hasDial=%d dialI2cFail=%lu i2cRecoveries=%lu maxLoopGapMs=%lu core1HeartbeatAgoMs=%lu maxLoop1GapMs=%lu",
    HAS_DIAL, s.dialI2cFailTotal, s.i2cRecoveries, maxLoopGapMs, now - s.core1HeartbeatMs, s.maxLoop1GapMs);
  diagPrint("[RS485 Node] diag: bootCount=%u watchdogReboots=%u lastRebootWasWatchdog=%d",
    bootCount, watchdogRebootCount, lastRebootWasWatchdog);
}

// ── Setup (core 0) ─────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  bootAtMs = millis();

  // MUST happen before core 1 ever starts touching sharedLock/logLock —
  // relies on arduino-pico's documented core-1-starts-after-core-0's-
  // setup()-returns ordering, see this file's header.
  critical_section_init(&sharedLock);
  critical_section_init(&logLock);

  pinMode(RS485_DE_RE_PIN, OUTPUT);
  digitalWrite(RS485_DE_RE_PIN, LOW);
  Serial1.setTX(0);
  Serial1.setRX(1);
  Serial1.begin(BAUD_RATE);

  pico_unique_board_id_t idOut;
  pico_get_unique_board_id(&idOut);
  memcpy(uniqueId, idOut.id, 8);

  loadAddressFromEEPROM();
  logBootDiagnostics();

  rp2040.wdt_begin(WATCHDOG_TIMEOUT_MS); // see WATCHDOG_TIMEOUT_MS's comment above

  logLine("[RS485 Node] Boot complete. Address: %d", busAddress);
  // Core 1 (setup1()/loop1()) starts automatically once this returns.
}

// ── Main loop (core 0) ────────────────────────────────────────────
void loop() {
  // Pet the watchdog unless core 1 has gone quiet for too long — see
  // CORE1_STALL_THRESHOLD_MS/CORE0_BOOT_GRACE_MS and this file's header
  // for the full reasoning. This is the crux of the whole fix: core 0
  // itself never blocks on anything that could hang, so it can always
  // truthfully answer "is core 1 actually still alive" and only give up
  // on it (letting the watchdog force a full reboot) when it genuinely
  // has gone silent, not just because THIS loop happened to stall.
  unsigned long core1Age;
  critical_section_enter_blocking(&sharedLock);
  core1Age = millis() - shared.core1HeartbeatMs;
  critical_section_exit(&sharedLock);
  if (millis() - bootAtMs < CORE0_BOOT_GRACE_MS || core1Age < CORE1_STALL_THRESHOLD_MS) {
    rp2040.wdt_reset();
  }

  // Tracks the longest gap this node has ever seen between two loop()
  // iterations — core 0 should never meaningfully stall anymore (it never
  // touches I2C), so this should stay near-zero; a creep here would now
  // point at something new, not the original I2C hang.
  unsigned long now = millis();
  if (lastLoopAt != 0) {
    unsigned long gap = now - lastLoopAt;
    if (gap > maxLoopGapMs) maxLoopGapMs = gap;
  }
  lastLoopAt = now;

  pollSerial();

  if (busAddress == 0x00 && millis() - lastAnnounce >= ANNOUNCE_INTERVAL_MS) {
    lastAnnounce = millis();
    sendAnnounce();
  }
}
