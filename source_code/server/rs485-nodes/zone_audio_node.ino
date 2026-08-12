/**
 * RS485 Zone Audio Node (RP2040)
 * ─────────────────────────────────────────────────────────────────
 * NOT YET BUILT/TESTED — no zone amp/audio-switching hardware exists yet
 * (matches the state server/services/sound.js and spotify.js already
 * document for the rest of the sound system). The RS485 protocol
 * integration below (frame format, CRC8, POLL_ZONE_AUDIO/ZONE_AUDIO_STATE
 * handling, commissioning) is written against the confirmed server-side
 * protocol in server/services/rs485.js and follows rs485_node.ino's
 * proven pattern exactly, so it should be correct as-is. The audio
 * front-end (signal-presence detection on the two override inputs) and
 * back-end (the actual switch/gain hardware) are real analog circuits
 * whose exact parts aren't chosen yet — see the placeholders below.
 *
 * ── What this node is, and isn't ─────────────────────────────────
 * One of these drives ONE room's speakers, with 3 audio inputs and a
 * fixed local priority between them: override2 (highest, reserved for a
 * future Pi-triggered alarm feed) > override1 (e.g. a TV) > Spotify
 * (lowest). THE PRIORITY DECISION HAPPENS ENTIRELY ON THIS BOARD, in
 * loop(), every cycle — never gated on an RS485 poll arriving. That's the
 * whole point: unplug the Pi, keep watching TV, audio switches instantly.
 * RS485 traffic to/from this node only ever does two things:
 *   - carries down whether Spotify is currently allowed to be the
 *     lowest-priority input at all (spotifyEnabled) + its volume — cached
 *     locally and reused if the bus goes quiet, so a stale cache is the
 *     only thing that degrades (Spotify plays or doesn't when it
 *     shouldn't/should — never affects the override inputs)
 *   - reports back which input is CURRENTLY actually selected, purely for
 *     the web app / a wall dial to display
 *
 * ── Hardware per node (TBD — analog front/back end not chosen yet) ──
 *   RP2040 board — same as rs485_node.ino, no Wi-Fi needed
 *   TTL-to-RS485 converter, DE/RE tied together — identical wiring to
 *     rs485_node.ino
 *   LM2596 buck converter off the shared bus 24V feed — same as every
 *     other node
 *   2x signal-presence-detection front end (override1, override2) — each
 *     one needs to turn "is there audio on this line" into a clean digital
 *     HIGH/LOW for this board to read. Common approach: op-amp envelope
 *     detector (rectify + low-pass + comparator against a small
 *     threshold) — exact parts TBD, this file just reads the resulting
 *     digital pin.
 *   Audio switch/gain stage — whatever actually selects one of the 3
 *     inputs onto the speaker output and sets Spotify's input gain (e.g.
 *     an analog mux IC for selection + a digital potentiometer or a
 *     PWM-driven VCA for Spotify gain). applyAudioRouting() below is a
 *     placeholder for driving that hardware once chosen.
 *
 * ── Wiring (placeholders) ────────────────────────────────────────
 *   RS485 module DI/RO/DE+RE/A+B'    → identical to rs485_node.ino
 *   Override1 presence-detect input  → GPIO 6  (placeholder)
 *   Override2 presence-detect input  → GPIO 7  (placeholder)
 *   Audio switch/gain control        → TBD, see applyAudioRouting()
 *
 * ── Protocol integration (server/services/rs485.js — read that file's
 *    header comment for the authoritative spec) ─────────────────────
 * POLL_ZONE_AUDIO (0x05, master→node, 2B): [spotifyEnabled 1B: 0/1]
 * [spotifyVolumePercent 1B].
 * ZONE_AUDIO_STATE (0x85, node→master reply, 1B): [activeSource 1B:
 * 0=off,1=spotify,2=override1,3=override2] — always this node's current
 * locally-decided value, computed independent of this poll.
 */

#include <EEPROM.h>
#include "pico/unique_id.h"

// ── Config — edit if your wiring differs ───────────────────────────
const int RS485_DE_RE_PIN = 2;
const unsigned long BAUD_RATE = 9600;
const unsigned long ANNOUNCE_INTERVAL_MS = 5000; // while unconfigured
const unsigned long EEPROM_SIZE = 8;
const int EEPROM_ADDR_BYTE = 0;

const int OVERRIDE1_DETECT_PIN = 6; // placeholder
const int OVERRIDE2_DETECT_PIN = 7; // placeholder

// ── Protocol constants — MUST match server/services/rs485.js ───────
const uint8_t SYNC = 0xAA;
const uint8_t CMD_ASSIGN = 0x02;
const uint8_t CMD_POLL_ZONE_AUDIO = 0x05;
const uint8_t CMD_ANNOUNCE = 0x81;
const uint8_t CMD_ZONE_AUDIO_STATE = 0x85;

const uint8_t SOURCE_OFF = 0, SOURCE_SPOTIFY = 1, SOURCE_OVERRIDE1 = 2, SOURCE_OVERRIDE2 = 3;

uint8_t busAddress = 0x00;
uint8_t uniqueId[8];
unsigned long lastAnnounce = 0;

// Cached from the master's last POLL_ZONE_AUDIO — reused as-is if the bus
// goes quiet, per this file's header comment.
bool spotifyEnabled = false;
uint8_t spotifyVolumePercent = 0;

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
  if (digitalRead(OVERRIDE2_DETECT_PIN) == HIGH) activeSource = SOURCE_OVERRIDE2;
  else if (digitalRead(OVERRIDE1_DETECT_PIN) == HIGH) activeSource = SOURCE_OVERRIDE1;
  else if (spotifyEnabled) activeSource = SOURCE_SPOTIFY;
  else activeSource = SOURCE_OFF;
  applyAudioRouting(activeSource, spotifyVolumePercent);
}

// PLACEHOLDER — drive whatever hardware actually selects the output and
// sets Spotify's gain once chosen (analog mux + digipot/VCA, most likely).
// Called every loop() with the current decision; keep it cheap/idempotent,
// this isn't gated or debounced.
void applyAudioRouting(uint8_t source, uint8_t volumePercent) {
  // TODO (bring-up): select `source` on the audio mux; if source ==
  // SOURCE_SPOTIFY, set the gain stage from volumePercent. Override
  // inputs pass through at their own native line level — this node
  // doesn't (and per the design, shouldn't) touch their volume.
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
    spotifyEnabled = payload[0] != 0;
    spotifyVolumePercent = payload[1];
    // Reply with whatever updateActiveSource() already decided in the
    // main loop — not recomputed here, this poll doesn't drive the
    // decision, it only reads it.
    sendZoneAudioState();
  }
}

void pollSerial() {
  while (Serial1.available()) {
    if (rxLen < sizeof(rxBuf)) rxBuf[rxLen++] = Serial1.read();
    else rxLen = 0;
  }
  if (rxLen < 4) return;

  uint8_t start = 0;
  while (start < rxLen && rxBuf[start] != SYNC) start++;
  if (start > 0) { memmove(rxBuf, rxBuf + start, rxLen - start); rxLen -= start; }
  if (rxLen < 4) return;

  uint8_t addr = rxBuf[1], cmd = rxBuf[2], len = rxBuf[3];
  if (rxLen < (uint16_t)(4 + len + 1)) return;

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
  pinMode(OVERRIDE2_DETECT_PIN, INPUT);

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
