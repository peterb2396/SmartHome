/**
 * RS485 Zone Audio Node (RP2040)
 * ─────────────────────────────────────────────────────────────────
 * NOT YET BUILT/TESTED — no zone amp/audio-switching hardware exists yet
 * (matches the state server/services/sound.js and spotify.js already
 * document for the rest of the sound system). The RS485 protocol
 * integration below (frame format, CRC8, POLL_ZONE_AUDIO/ZONE_AUDIO_STATE
 * handling, commissioning) is written against the confirmed server-side
 * protocol in server/services/rs485.js and follows rs485_node.ino's
 * proven pattern exactly, so it should be correct as-is. Part numbers
 * referenced below (CD4066, PT2258, LM393) match the hardware BOM doc —
 * see that doc for full wiring/datasheet-level detail; this file just
 * needs the GPIO/I2C control lines to land right.
 *
 * ── What this node is, and isn't ─────────────────────────────────
 * One of these drives ONE room's speakers, with 2 audio inputs wired in
 * and 3 priority TIERS: announcement (highest) > override1/TV (mid) >
 * Spotify (lowest). THE PRIORITY DECISION HAPPENS ENTIRELY ON THIS BOARD,
 * in loop(), every cycle — never gated on an RS485 poll arriving. That's
 * the whole point: unplug the Pi, keep watching TV, audio switches
 * instantly. The announcement tier is the one exception to "decided
 * entirely locally" — see below.
 *
 * Only ONE of the two physical inputs is actually local to this room:
 * override1 (the TV). The OTHER input (labeled "shared" throughout) is
 * the Pi's own line-out, distributed to every zone node on the same
 * physical bus (see the hardware BOM doc) — it carries EITHER Spotify OR
 * an announcement, never both at once (same "one stream" limit
 * spotify.js's header documents for Spotify alone), so this node can't
 * tell which one it means just from the audio — the master tells it via
 * two independent flags:
 *   - spotifyEnabled: the shared input counts as tier-0 (loses to
 *     override1) — cached locally and reused if the bus goes quiet, so a
 *     stale cache is the only thing that degrades (Spotify plays or
 *     doesn't when it shouldn't/should — never affects override1)
 *   - announcementActive: the shared input counts as tier-2 (wins over
 *     everything) — same caching behavior. This is how "announce to
 *     specific zones" works: targeting a zone is nothing more than the
 *     master setting this flag for it and not for others (see
 *     server/services/sound.js's setAnnouncementTargets()) — this board
 *     doesn't know or care that it's part of a multi-zone announcement,
 *     it just sees its own flag.
 * RS485 traffic to/from this node otherwise only reports back which
 * input is CURRENTLY actually selected, purely for the web app / a wall
 * dial to display.
 *
 * ── Hardware per node ───────────────────────────────────────────
 *   RP2040 board — same as rs485_node.ino, no Wi-Fi needed
 *   TTL-to-RS485 converter, DE/RE tied together — identical wiring to
 *     rs485_node.ino
 *   LM2596 buck converter off the shared bus 24V feed — same as every
 *     other node (this is the LOW-VOLTAGE LOGIC supply only — the power
 *     amp stage downstream of this board has its own, separate, much
 *     larger 24V supply; see the hardware BOM doc for why those must NOT
 *     share a rail)
 *   Override1 (TV) presence-detect front end: precision rectifier
 *     (1N4148 pair) + RC low-pass + LM393 comparator against a threshold
 *     set by a trimpot (levels vary source to source — needs field
 *     adjustment, not a fixed resistor value) → clean digital HIGH/LOW
 *     into OVERRIDE1_DETECT_PIN
 *   Audio switching: CD4066 quad bilateral switch, 2 of its 4 switches
 *     used per stereo channel (one per source) — AUDIO_SELECT_LOCAL_PIN
 *     and AUDIO_SELECT_SHARED_PIN drive which source reaches the amp
 *     input; NEVER both high at once (signal contention) — see
 *     applyAudioRouting() below, which already enforces that
 *   Spotify/shared-input volume: PT2258 I2C electronic volume control
 *     (6dB steps) between the shared input and the CD4066 — only
 *     attenuates the shared input, never override1, matching "this node
 *     doesn't touch override1's own volume" from the design
 *   Amp mute: most Class-D amp boards (e.g. TPA3116-based) expose a
 *     MUTE/SD pin — drive it from AMP_MUTE_PIN so "off" is real silence,
 *     not a floating amp input picking up noise
 *
 * ── Wiring ──────────────────────────────────────────────────────
 *   RS485 module DI/RO/DE+RE/A+B'    → identical to rs485_node.ino
 *   Override1 (TV) presence-detect   → GPIO 6
 *   Audio select — local (TV)        → GPIO 7
 *   Audio select — shared (Pi bus)   → GPIO 8
 *   Amp mute/shutdown                → GPIO 9
 *   PT2258 I2C                       → GPIO 4 (SDA) / GPIO 5 (SCL)
 *
 * ── Protocol integration (server/services/rs485.js — read that file's
 *    header comment for the authoritative spec) ─────────────────────
 * POLL_ZONE_AUDIO (0x05, master→node, 2B): [flags 1B: bit0 spotifyEnabled,
 * bit1 announcementActive][spotifyVolumePercent 1B].
 * ZONE_AUDIO_STATE (0x85, node→master reply, 1B): [activeSource 1B:
 * 0=off,1=spotify,2=override1,3=override2 — "override2" here means "the
 * shared input, at announcement priority," not a second physical input]
 * — always this node's current locally-decided value, computed
 * independent of this poll.
 */

#include <EEPROM.h>
#include <Wire.h>
#include "pico/unique_id.h"

// ── Config — edit if your wiring differs ───────────────────────────
const int RS485_DE_RE_PIN = 2;
const unsigned long BAUD_RATE = 9600;
const unsigned long ANNOUNCE_INTERVAL_MS = 5000; // while unconfigured
const unsigned long EEPROM_SIZE = 8;
const int EEPROM_ADDR_BYTE = 0;

const int OVERRIDE1_DETECT_PIN       = 6;
const int AUDIO_SELECT_LOCAL_PIN     = 7; // CD4066: routes override1 (TV) to the amp
const int AUDIO_SELECT_SHARED_PIN    = 8; // CD4066: routes the shared Pi input to the amp
const int AMP_MUTE_PIN               = 9; // HIGH = muted, matches most TPA3116 boards' SD/MUTE convention — confirm against your board
const int PT2258_SDA_PIN = 4, PT2258_SCL_PIN = 5;
const uint8_t PT2258_I2C_ADDR = 0x88 >> 1; // datasheet gives the 8-bit write address 0x88; Wire uses the 7-bit form

// ── Protocol constants — MUST match server/services/rs485.js ───────
const uint8_t SYNC = 0xAA;
const uint8_t CMD_ASSIGN = 0x02;
const uint8_t CMD_POLL_ZONE_AUDIO = 0x05;
const uint8_t CMD_ANNOUNCE = 0x81;
const uint8_t CMD_ZONE_AUDIO_STATE = 0x85;

const uint8_t SOURCE_OFF = 0, SOURCE_SPOTIFY = 1, SOURCE_OVERRIDE1 = 2, SOURCE_ANNOUNCEMENT = 3;

uint8_t busAddress = 0x00;
uint8_t uniqueId[8];
unsigned long lastAnnounce = 0;

// Cached from the master's last POLL_ZONE_AUDIO — reused as-is if the bus
// goes quiet, per this file's header comment.
bool spotifyEnabled = false;
bool announcementActive = false;
uint8_t spotifyVolumePercent = 0;
uint8_t lastAppliedVolumePercent = 0xFF; // impossible value, forces the first PT2258 write

// The node's own current decision — recomputed every loop() iteration,
// never waits on a poll. What ZONE_AUDIO_STATE replies with.
uint8_t activeSource = SOURCE_OFF;

// ── CRC8 (poly 0x07) — must match crc8() in rs485.js ────────────────
uint8_t crc8(const uint8_t* data, size_t len) {
  uint8_t crc = 0;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1);
  }
  return crc;
}

// ── Half-duplex send: assert DE/RE, write, wait for the line to clear ──
void sendFrame(uint8_t addr, uint8_t cmd, const uint8_t* payload, uint8_t len) {
  uint8_t head[3] = { addr, cmd, len };
  uint8_t crcInput[3 + 32];
  memcpy(crcInput, head, 3);
  if (len > 0) memcpy(crcInput + 3, payload, len);
  uint8_t crc = crc8(crcInput, 3 + len);

  digitalWrite(RS485_DE_RE_PIN, HIGH);
  delayMicroseconds(50);
  Serial1.write(SYNC);
  Serial1.write(head, 3);
  if (len > 0) Serial1.write(payload, len);
  Serial1.write(crc);
  Serial1.flush();
  delayMicroseconds(50);
  digitalWrite(RS485_DE_RE_PIN, LOW);
}

void sendAnnounce() {
  uint8_t payload[9];
  memcpy(payload, uniqueId, 8);
  payload[8] = 0x01; // capability bitmask — informational only, matches other node types' convention
  sendFrame(0x00, CMD_ANNOUNCE, payload, 9);
}

void sendZoneAudioState() {
  uint8_t payload[1] = { activeSource };
  sendFrame(busAddress, CMD_ZONE_AUDIO_STATE, payload, 1);
}

// ── Local priority decision — the whole point of this node, runs every
// loop() regardless of RS485 activity ───────────────────────────────
void updateActiveSource() {
  bool override1Present = digitalRead(OVERRIDE1_DETECT_PIN) == HIGH;
  if (announcementActive) activeSource = SOURCE_ANNOUNCEMENT; // wins even over override1 — see this file's header
  else if (override1Present) activeSource = SOURCE_OVERRIDE1;
  else if (spotifyEnabled) activeSource = SOURCE_SPOTIFY;
  else activeSource = SOURCE_OFF;
  applyAudioRouting(activeSource, spotifyVolumePercent);
}

// Drives the CD4066 selector + amp mute + PT2258 volume for the current
// decision. Called every loop() iteration; the digitalWrite()/PT2258
// calls below are cheap and idempotent-safe to repeat, EXCEPT the PT2258
// write, which is skipped unless the volume actually changed (I2C writes
// are slow relative to loop() rate — no reason to hammer it every cycle
// with the same value).
void applyAudioRouting(uint8_t source, uint8_t volumePercent) {
  bool useShared = (source == SOURCE_SPOTIFY || source == SOURCE_ANNOUNCEMENT);
  bool useLocal  = (source == SOURCE_OVERRIDE1);

  // Break-before-make: always drop both selects before asserting the new
  // one, so there's never a moment with both switches closed (the two
  // sources' outputs would briefly fight each other otherwise).
  digitalWrite(AUDIO_SELECT_LOCAL_PIN, LOW);
  digitalWrite(AUDIO_SELECT_SHARED_PIN, LOW);
  if (useLocal) digitalWrite(AUDIO_SELECT_LOCAL_PIN, HIGH);
  else if (useShared) digitalWrite(AUDIO_SELECT_SHARED_PIN, HIGH);

  digitalWrite(AMP_MUTE_PIN, source == SOURCE_OFF ? HIGH : LOW);

  // Only the shared input's own volume is under this node's control —
  // override1 passes through at its native line level, per the design.
  if (useShared && volumePercent != lastAppliedVolumePercent) {
    setPT2258Volume(volumePercent);
    lastAppliedVolumePercent = volumePercent;
  }
}

// PT2258: 6dB-step attenuator, so 0-100% is mapped onto its 0(loudest)-
// 0x1F(muted) attenuation register range — TODO (bring-up): confirm
// against the PT2258 datasheet's exact command byte layout for channel
// select + attenuation before trusting this mapping; this is the
// intended shape, not yet verified against a real chip.
void setPT2258Volume(uint8_t volumePercent) {
  uint8_t attenuationStep = map(volumePercent, 0, 100, 0x1F, 0x00);
  Wire.beginTransmission(PT2258_I2C_ADDR);
  Wire.write(0xC0 | (attenuationStep & 0x0F));       // channel volume, low nibble
  Wire.write(0xD0 | ((attenuationStep >> 4) & 0x03)); // channel volume, high nibble
  Wire.endTransmission();
}

void loadAddressFromEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  busAddress = EEPROM.read(EEPROM_ADDR_BYTE);
  if (busAddress == 0xFF) busAddress = 0x00;
}

void saveAddressToEEPROM(uint8_t addr) {
  busAddress = addr;
  EEPROM.write(EEPROM_ADDR_BYTE, addr);
  EEPROM.commit();
}

// ── Receive + dispatch (identical framing logic to rs485_node.ino) ─────
uint8_t rxBuf[64];
uint8_t rxLen = 0;

void handleFrame(uint8_t addr, uint8_t cmd, uint8_t* payload, uint8_t len) {
  if (cmd == CMD_ASSIGN && addr == 0x00 && len == 9) {
    if (memcmp(payload, uniqueId, 8) == 0) {
      saveAddressToEEPROM(payload[8]);
      Serial.printf("[ZoneAudio] Assigned bus address %d\n", busAddress);
    }
    return;
  }
  if (busAddress == 0x00 || addr != busAddress) return;

  if (cmd == CMD_POLL_ZONE_AUDIO && len >= 2) {
    spotifyEnabled = payload[0] & 0x01;
    announcementActive = payload[0] & 0x02;
    spotifyVolumePercent = payload[1];
    // Reply with whatever updateActiveSource() already decided in the
    // main loop — not recomputed here, this poll doesn't drive the
    // decision, it only reads it.
    sendZoneAudioState();
  }
}

// Resync safety net — same fix, same reasoning, as rs485_node.ino's
// pollSerial(); see that file's comment for the full explanation. Without
// this, a single noise glitch permanently wedges this node's receiver
// until power-cycled, indistinguishable from a dead node to the master.
const uint8_t MAX_PAYLOAD_LEN = 32; // largest real payload today is well under this
const unsigned long FRAME_STALL_MS = 500;
bool awaitingFrame = false;
unsigned long awaitingFrameSince = 0;

void pollSerial() {
  while (Serial1.available()) {
    if (rxLen < sizeof(rxBuf)) rxBuf[rxLen++] = Serial1.read();
    else { rxLen = 0; awaitingFrame = false; }
  }
  if (rxLen < 4) { awaitingFrame = false; return; }

  uint8_t start = 0;
  while (start < rxLen && rxBuf[start] != SYNC) start++;
  if (start > 0) { memmove(rxBuf, rxBuf + start, rxLen - start); rxLen -= start; }
  if (rxLen < 4) { awaitingFrame = false; return; }

  uint8_t len = rxBuf[3];
  if (len > MAX_PAYLOAD_LEN) {
    memmove(rxBuf, rxBuf + 1, rxLen - 1);
    rxLen -= 1;
    awaitingFrame = false;
    return;
  }

  if (rxLen < (uint16_t)(4 + len + 1)) {
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

// ── Setup ────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(RS485_DE_RE_PIN, OUTPUT);
  digitalWrite(RS485_DE_RE_PIN, LOW);
  Serial1.setTX(0);
  Serial1.setRX(1);
  Serial1.begin(BAUD_RATE);

  pinMode(OVERRIDE1_DETECT_PIN, INPUT);
  pinMode(AUDIO_SELECT_LOCAL_PIN, OUTPUT);
  pinMode(AUDIO_SELECT_SHARED_PIN, OUTPUT);
  pinMode(AMP_MUTE_PIN, OUTPUT);
  digitalWrite(AUDIO_SELECT_LOCAL_PIN, LOW);
  digitalWrite(AUDIO_SELECT_SHARED_PIN, LOW);
  digitalWrite(AMP_MUTE_PIN, HIGH); // muted until the first real decision is applied

  Wire.setSDA(PT2258_SDA_PIN);
  Wire.setSCL(PT2258_SCL_PIN);
  Wire.begin();

  pico_unique_board_id_t idOut;
  pico_get_unique_board_id(&idOut);
  memcpy(uniqueId, idOut.id, 8);

  loadAddressFromEEPROM();

  Serial.printf("[ZoneAudio] Boot complete. Address: %d\n", busAddress);
}

// ── Main loop ────────────────────────────────────────────────────────
void loop() {
  updateActiveSource(); // every iteration — the local decision never waits on the bus
  pollSerial();

  if (busAddress == 0x00 && millis() - lastAnnounce >= ANNOUNCE_INTERVAL_MS) {
    lastAnnounce = millis();
    sendAnnounce();
  }
}
