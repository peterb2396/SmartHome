/**
 * RS485 Wall Dial (ESP32 + round touchscreen + physical rotary encoder)
 * ─────────────────────────────────────────────────────────────────
 * NOT YET FLASHED/COMPILE-TESTED — unlike rs485_node.ino (confirmed working
 * against real sensor-node hardware), there is no dial hardware in hand
 * yet. The RS485 protocol integration below (frame format, CRC8, POLL_DIAL/
 * DIAL_STATE handling, commissioning) is written against the confirmed
 * server-side protocol in server/services/rs485.js and should be correct
 * as-is. The DISPLAY_* / TOUCH_* pin numbers and the display/touch driver
 * init calls are placeholders following this class of board's common
 * defaults — treat first flash as a full bring-up: confirm the exact
 * display controller, touch controller, and pin mapping against the real
 * board's documentation/silkscreen and correct LVGL_DISPLAY_INIT()/
 * LVGL_TOUCH_INIT()/ENCODER_* pins below before trusting the UI renders.
 *
 * Same commissioning flow as every other RS485 node (see rs485_node.ino):
 * announces on address 0x00 with its unique chip ID until assigned an
 * address from the Console's "New Nodes" panel — set `kind` to "dial"
 * there so the server polls it on the fast dial loop
 * (server/services/rs485.js's pollAllDials()), not the 10s sensor loop.
 * Thermostat zone and sound zone are separate id spaces (see
 * server/services/sound.js's header) — the Console lets a dial be
 * assigned a thermostat zone, a sound zone, or both.
 *
 * ── Hardware ────────────────────────────────────────────────────────
 *   ESP32-S3 (needs the RAM/clock for a 480x480 LVGL framebuffer — a
 *     plain ESP32 is underpowered for this display size)
 *   Round touchscreen, 480x480, capacitive touch — QSPI or SPI display
 *     controller (exact chip TBD from the board's datasheet)
 *   Physical rotary encoder (mechanical, separate from the touchscreen —
 *     confirmed, not touch-gesture rotation) — 2 quadrature pins (A/B),
 *     optional integrated push-button
 *   TTL-to-RS485 module (auto-direction, same style as the sensor nodes —
 *     see rs485_node.ino's wiring section for the RX/TX/A+/B-/earth
 *     mapping, identical here)
 *   LM2596 buck converter off the shared bus 24V feed, same as every
 *     other node
 *
 * ── Libraries (Arduino Library Manager) ────────────────────────────
 *   lvgl (v8.3.x)              — GUI framework; this file targets the v8 API
 *   [Board's display driver library — TBD once the exact controller chip
 *     is confirmed, e.g. Arduino_GFX or a vendor-specific driver]
 *   EEPROM                     bundled with the ESP32 Arduino core
 *
 * ── Wiring (placeholders — confirm against real board silkscreen) ──
 *   RS485 module RX/TX/A+/B-/earth → same pattern as rs485_node.ino
 *   Encoder A                       → GPIO 4  (placeholder)
 *   Encoder B                       → GPIO 5  (placeholder)
 *   Encoder push-button (optional)  → GPIO 6  (placeholder)
 *   Display + touch                → whatever the board's onboard FPC
 *     connector fixes them to — not user-wired, but the specific GPIO
 *     numbers still need confirming in LVGL_DISPLAY_INIT()/LVGL_TOUCH_INIT()
 *     against the board's own reference example.
 *
 * ── Protocol integration (server/services/rs485.js — read that file's
 *    header comment for the authoritative spec) ──────────────────────
 * POLL_DIAL (0x04, master→dial, 25B): targetF, currentF, humidity, co2,
 * outdoorF (5x float32) + flags (1B: bit0 callingHeat, bit1 callingCool,
 * bit2 safetyActive, bit3 weatherStale, bit4 spotifyEnabled) + hour,
 * minute (1B each) + volumePercent, activeSource (1B each: 0=off,
 * 1=spotify,2=override1,3=override2). activeSource is that zone's own
 * audio hardware's CURRENT hardware-detected input (a separate zoneAudio
 * node, not this dial) — display-only here, same as on the website; this
 * dial has no say in which input wins.
 *
 * DIAL_STATE (0x84, dial→master reply, 8B): mode (1B: 0=thermostat,
 * 1=sound) + newTargetF (float32) + changed (1B) + tapEvent (1B) +
 * newVolumePercent (1B). newTargetF/newVolumePercent are always this
 * node's own locally-tracked ABSOLUTE values (never deltas) — the master
 * pushes the current value down every cycle specifically so a dropped
 * frame can't cause drift; this node just keeps incrementing its local
 * copy from encoder turns and reports where it currently sits.
 * tapEvent: 0=none, 1=wake, 2=menuSelect, 3=toggle Spotify-enabled for
 * this dial's sound zone (tapping the Sound screen itself — see onTap()).
 * That's strictly a Spotify on/off gate; it never touches override inputs.
 */

#include <Wire.h>
#include <EEPROM.h>
#include <lvgl.h>

// ── Config — confirm against real hardware during bring-up ─────────────
const int RS485_RX_PIN = 16;      // placeholder
const int RS485_TX_PIN = 17;      // placeholder
const unsigned long RS485_BAUD = 9600;

const int ENCODER_PIN_A = 4;      // placeholder
const int ENCODER_PIN_B = 5;      // placeholder
const int ENCODER_BUTTON_PIN = 6; // placeholder, optional secondary confirm

const unsigned long ANNOUNCE_INTERVAL_MS = 5000;
const unsigned long POLL_TIMEOUT_HINT_MS = 200; // matches DIAL_POLL_RESPONSE_TIMEOUT_MS server-side
const unsigned long IDLE_TIMEOUT_MS = 20000;    // no interaction -> back to IDLE (screen off)
const unsigned long MENU_TIMEOUT_MS = 8000;     // no interaction on the menu -> back to IDLE

const float TARGET_MIN_F = 60, TARGET_MAX_F = 75; // matches thermostat.js's safety range
const float TARGET_STEP_F = 0.5;
const int VOLUME_STEP = 2;

const unsigned long EEPROM_SIZE = 8;
const int EEPROM_ADDR_BYTE = 0;

// ── Colors — mirrors web/src/styles/tokens.js so the dial's thermostat/
// sound screens read as the same product as the website, not a separate
// one ──────────────────────────────────────────────────────────────────
#define COLOR_BG        lv_color_hex(0xF8FAFC)
#define COLOR_CARD      lv_color_hex(0xFFFFFF)
#define COLOR_TEXT      lv_color_hex(0x1E293B)
#define COLOR_MUTED     lv_color_hex(0x64748B)
#define COLOR_ACCENT    lv_color_hex(0x3B82F6)
#define COLOR_HEAT      lv_color_hex(0xFB923C) // calling-heat orange, matches ZoneCard.jsx
#define COLOR_COOL      lv_color_hex(0x60A5FA) // calling-cool blue
#define COLOR_DANGER    lv_color_hex(0xEF4444) // safety override red
#define COLOR_SPOTIFY   lv_color_hex(0x1DB954)

// ── Protocol constants — MUST match server/services/rs485.js ──────────
const uint8_t SYNC = 0xAA;
const uint8_t CMD_ASSIGN = 0x02;
const uint8_t CMD_POLL_DIAL = 0x04;
const uint8_t CMD_ANNOUNCE = 0x81;
const uint8_t CMD_DIAL_STATE = 0x84;

const uint8_t MODE_THERMOSTAT = 0;
const uint8_t MODE_SOUND = 1;

uint8_t busAddress = 0x00;
uint8_t uniqueId[8];
unsigned long lastAnnounce = 0;

// ── Local live state — updated from POLL_DIAL pushes, and by the encoder
// between pushes; DIAL_STATE always reports these absolute values back ──
struct DialState {
  float targetF = 68, currentF = 0, humidity = 0, co2 = 0, outdoorF = 0;
  bool callingHeat = false, callingCool = false, safetyActive = false, weatherStale = true;
  uint8_t hour = 0, minute = 0;
  uint8_t volumePercent = 0;
  uint8_t activeSource = 0;   // 0=off,1=spotify,2=override1,3=override2 — hardware-detected, read-only here
  bool spotifyEnabled = false; // this dial's own optimistic copy — see onTap()'s SCREEN_SOUND case
} state;

bool pendingChange = false;   // set when the encoder has moved something since the last poll reply
uint8_t pendingTapEvent = 0;  // 0=none,1=wake,2=menuSelect,3=toggleSpotifyEnabled

// ── Screen state machine ────────────────────────────────────────────────
enum Screen { SCREEN_IDLE, SCREEN_CLOCK, SCREEN_MENU, SCREEN_THERMOSTAT, SCREEN_SOUND };
Screen currentScreen = SCREEN_IDLE;
int menuSelection = 0; // 0=Sound, 1=Thermostat — cycled by rotating on SCREEN_MENU
unsigned long lastInteractionAt = 0;

// ── CRC8 (poly 0x07) — must match crc8() in rs485.js ──────────────────
uint8_t crc8(const uint8_t* data, size_t len) {
  uint8_t crc = 0;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1);
  }
  return crc;
}

// RS485 module here is assumed auto-direction (no DE/RE GPIO to drive) —
// same variant as documented in the wiring guide for the sensor nodes. If
// the real module needs manual DE/RE, add that pin toggle around the
// Serial2.write() calls below, mirroring rs485_node.ino's sendFrame().
void sendFrame(uint8_t addr, uint8_t cmd, const uint8_t* payload, uint8_t len) {
  uint8_t head[3] = { addr, cmd, len };
  uint8_t crcInput[3 + 32];
  memcpy(crcInput, head, 3);
  if (len > 0) memcpy(crcInput + 3, payload, len);
  uint8_t crc = crc8(crcInput, 3 + len);

  Serial2.write(SYNC);
  Serial2.write(head, 3);
  if (len > 0) Serial2.write(payload, len);
  Serial2.write(crc);
  Serial2.flush();
}

void sendAnnounce() {
  uint8_t payload[9];
  memcpy(payload, uniqueId, 8);
  payload[8] = 0x01; // capability bitmask — informational only, matches sensor nodes' convention
  sendFrame(0x00, CMD_ANNOUNCE, payload, 9);
}

void sendDialState() {
  uint8_t payload[8];
  payload[0] = (currentScreen == SCREEN_SOUND) ? MODE_SOUND : MODE_THERMOSTAT;
  memcpy(payload + 1, &state.targetF, 4);
  payload[5] = pendingChange ? 1 : 0;
  payload[6] = pendingTapEvent;
  payload[7] = state.volumePercent;
  sendFrame(busAddress, CMD_DIAL_STATE, payload, 8);
  pendingChange = false;
  pendingTapEvent = 0;
}

void applyPollDialPayload(const uint8_t* p, uint8_t len) {
  if (len < 25) return;
  // memcpy, not a pointer cast — `p` isn't guaranteed 4-byte aligned
  // (it's a slice into rxBuf at a variable offset), and dereferencing an
  // unaligned float* is undefined behavior even though Xtensa usually
  // tolerates it in practice.
  memcpy(&state.targetF,  p + 0,  4);
  memcpy(&state.currentF, p + 4,  4);
  memcpy(&state.humidity, p + 8,  4);
  memcpy(&state.co2,      p + 12, 4);
  memcpy(&state.outdoorF, p + 16, 4);
  uint8_t flags = p[20];
  state.callingHeat    = flags & 0x01;
  state.callingCool    = flags & 0x02;
  state.safetyActive   = flags & 0x04;
  state.weatherStale   = flags & 0x08;
  state.spotifyEnabled = flags & 0x10; // authoritative — overwrites any optimistic tap-toggle
  state.hour   = p[21];
  state.minute = p[22];
  state.volumePercent = p[23];
  state.activeSource = p[24];
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
      Serial.printf("[Dial] Assigned bus address %d\n", busAddress);
    }
    return;
  }
  if (busAddress == 0x00 || addr != busAddress) return;

  if (cmd == CMD_POLL_DIAL) {
    applyPollDialPayload(payload, len);
    // Reply before redrawing — the master only waits
    // DIAL_POLL_RESPONSE_TIMEOUT_MS (200ms) for this, and LVGL widget
    // rebuild work shouldn't eat into that budget.
    sendDialState();
    refreshActiveScreen();
  }
}

void pollSerial() {
  while (Serial2.available()) {
    if (rxLen < sizeof(rxBuf)) rxBuf[rxLen++] = Serial2.read();
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

// ── Rotary encoder — standard quadrature ISR decode ─────────────────────
volatile int encoderDelta = 0;
void IRAM_ATTR onEncoderChange() {
  static uint8_t lastState = 0;
  uint8_t a = digitalRead(ENCODER_PIN_A), b = digitalRead(ENCODER_PIN_B);
  uint8_t state8 = (a << 1) | b;
  uint8_t combined = (lastState << 2) | state8;
  if (combined == 0b0001 || combined == 0b0111 || combined == 0b1110 || combined == 0b1000) encoderDelta++;
  else if (combined == 0b0010 || combined == 0b1011 || combined == 0b1101 || combined == 0b0100) encoderDelta--;
  lastState = state8;
}

// Consumes accumulated encoder ticks since the last call and applies them
// to whatever the current screen means by "rotate" — menu cycling, target
// adjustment, or volume adjustment. Called from the main loop, not the ISR,
// so it can safely touch LVGL/state.
void processEncoder() {
  noInterrupts();
  int delta = encoderDelta;
  encoderDelta = 0;
  interrupts();
  if (delta == 0) return;

  lastInteractionAt = millis();
  switch (currentScreen) {
    case SCREEN_CLOCK:
      currentScreen = SCREEN_MENU;
      showMenuScreen();
      break;
    case SCREEN_MENU:
      menuSelection = (menuSelection + (delta > 0 ? 1 : -1) + 2) % 2;
      showMenuScreen();
      break;
    case SCREEN_THERMOSTAT: {
      float next = state.targetF + delta * TARGET_STEP_F;
      state.targetF = constrain(next, TARGET_MIN_F, TARGET_MAX_F);
      pendingChange = true;
      showThermostatScreen();
      break;
    }
    case SCREEN_SOUND: {
      int next = state.volumePercent + delta * VOLUME_STEP;
      state.volumePercent = constrain(next, 0, 100);
      pendingChange = true;
      showSoundScreen();
      break;
    }
    default: break;
  }
}

// ── Touch wake / tap handling ────────────────────────────────────────────
// LVGL_TOUCH_INIT() below is expected to feed LVGL's own input device
// driver, which is what actually detects taps for widgets on-screen (e.g.
// tapping a menu item). This handles the two things that aren't a normal
// LVGL widget tap: waking from IDLE, and confirming a MENU selection.
void onTap() {
  lastInteractionAt = millis();
  if (currentScreen == SCREEN_IDLE) {
    currentScreen = SCREEN_CLOCK;
    pendingTapEvent = 1; // wake
    showClockScreen();
  } else if (currentScreen == SCREEN_MENU) {
    pendingTapEvent = 2; // menuSelect
    currentScreen = (menuSelection == 0) ? SCREEN_SOUND : SCREEN_THERMOSTAT;
    if (currentScreen == SCREEN_SOUND) showSoundScreen(); else showThermostatScreen();
  } else if (currentScreen == SCREEN_SOUND) {
    // Tapping the Sound screen toggles this zone's Spotify enable gate —
    // strictly that, never the override inputs (see this file's header).
    // Flips the local copy immediately so the UI responds without waiting
    // for a round trip; the next POLL_DIAL push's flags byte is
    // authoritative and will correct it if the toggle is ever rejected
    // server-side (e.g. no soundZoneId configured for this dial).
    pendingTapEvent = 3; // toggleSpotifyEnabled
    state.spotifyEnabled = !state.spotifyEnabled;
    showSoundScreen();
  }
}

void checkIdleTimeout() {
  unsigned long timeout = (currentScreen == SCREEN_MENU) ? MENU_TIMEOUT_MS : IDLE_TIMEOUT_MS;
  if (currentScreen != SCREEN_IDLE && millis() - lastInteractionAt > timeout) {
    currentScreen = SCREEN_IDLE;
    showIdleScreen();
  }
}

void refreshActiveScreen() {
  switch (currentScreen) {
    case SCREEN_CLOCK:       showClockScreen();       break;
    case SCREEN_THERMOSTAT:  showThermostatScreen();  break;
    case SCREEN_SOUND:       showSoundScreen();       break;
    default: break; // IDLE/MENU don't depend on pushed state
  }
}

// ── LVGL screens ──────────────────────────────────────────────────────
// Widget creation kept simple and re-created per redraw rather than
// diffed/updated in place — at this update rate (once per ~poll reply,
// not every frame) that's simpler and plenty fast, and avoids a class of
// stale-widget-handle bugs while this is still unverified against real
// hardware. Revisit for partial updates once real hardware bring-up shows
// it's needed.
lv_obj_t* screenIdle;
lv_obj_t* screenClock;
lv_obj_t* screenMenu;
lv_obj_t* screenThermostat;
lv_obj_t* screenSound;

void showIdleScreen() {
  lv_obj_clean(screenIdle);
  lv_obj_set_style_bg_color(screenIdle, lv_color_black(), 0);
  lv_scr_load(screenIdle);
}

void showClockScreen() {
  lv_obj_clean(screenClock);
  lv_obj_set_style_bg_color(screenClock, COLOR_BG, 0);

  char timeStr[6];
  snprintf(timeStr, sizeof(timeStr), "%02d:%02d", state.hour, state.minute);
  lv_obj_t* time = lv_label_create(screenClock);
  lv_label_set_text(time, timeStr);
  lv_obj_set_style_text_color(time, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(time, &lv_font_montserrat_48, 0);
  lv_obj_align(time, LV_ALIGN_CENTER, 0, -30);

  char weatherStr[24];
  if (state.weatherStale) snprintf(weatherStr, sizeof(weatherStr), "-- (stale)");
  else snprintf(weatherStr, sizeof(weatherStr), "%.0f F outside", state.outdoorF);
  lv_obj_t* weather = lv_label_create(screenClock);
  lv_label_set_text(weather, weatherStr);
  lv_obj_set_style_text_color(weather, COLOR_MUTED, 0);
  lv_obj_align(weather, LV_ALIGN_CENTER, 0, 30);

  lv_scr_load(screenClock);
}

void showMenuScreen() {
  lv_obj_clean(screenMenu);
  lv_obj_set_style_bg_color(screenMenu, COLOR_BG, 0);

  const char* labels[2] = { "Sound", "Thermostat" };
  for (int i = 0; i < 2; i++) {
    lv_obj_t* item = lv_label_create(screenMenu);
    lv_label_set_text(item, labels[i]);
    lv_obj_set_style_text_font(item, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(item, i == menuSelection ? COLOR_ACCENT : COLOR_MUTED, 0);
    lv_obj_align(item, LV_ALIGN_CENTER, 0, (i == 0 ? -30 : 30));
  }
  lv_scr_load(screenMenu);
}

// Mirrors web/src/components/ThermoDial.jsx: a circular arc showing target
// position within the safety range, colored by calling state.
void showThermostatScreen() {
  lv_obj_clean(screenThermostat);
  lv_obj_set_style_bg_color(screenThermostat, COLOR_BG, 0);

  lv_color_t arcColor = state.safetyActive ? COLOR_DANGER
    : state.callingHeat ? COLOR_HEAT
    : state.callingCool ? COLOR_COOL
    : COLOR_ACCENT;

  lv_obj_t* arc = lv_arc_create(screenThermostat);
  lv_obj_set_size(arc, 260, 260);
  lv_arc_set_range(arc, (int)(TARGET_MIN_F * 10), (int)(TARGET_MAX_F * 10));
  lv_arc_set_value(arc, (int)(state.targetF * 10));
  lv_obj_set_style_arc_color(arc, arcColor, LV_PART_INDICATOR);
  lv_obj_remove_style(arc, NULL, LV_PART_KNOB); // read-only visual, encoder drives value directly
  lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_align(arc, LV_ALIGN_CENTER, 0, 0);

  char targetStr[8];
  snprintf(targetStr, sizeof(targetStr), "%.0f\xC2\xB0", state.targetF);
  lv_obj_t* targetLabel = lv_label_create(screenThermostat);
  lv_label_set_text(targetLabel, targetStr);
  lv_obj_set_style_text_font(targetLabel, &lv_font_montserrat_48, 0);
  lv_obj_set_style_text_color(targetLabel, COLOR_TEXT, 0);
  lv_obj_align(targetLabel, LV_ALIGN_CENTER, 0, -10);

  char currentStr[24];
  snprintf(currentStr, sizeof(currentStr), "now %.1f\xC2\xB0", state.currentF);
  lv_obj_t* currentLabel = lv_label_create(screenThermostat);
  lv_label_set_text(currentLabel, currentStr);
  lv_obj_set_style_text_color(currentLabel, COLOR_MUTED, 0);
  lv_obj_align(currentLabel, LV_ALIGN_CENTER, 0, 35);

  // Humidity/CO2 readouts — same numbers EnvironmentRow.jsx shows on the
  // web app, just plain text here rather than a range bar (screen space).
  char envStr[40];
  snprintf(envStr, sizeof(envStr), "%.0f%% RH   %.0f ppm CO2", state.humidity, state.co2);
  lv_obj_t* env = lv_label_create(screenThermostat);
  lv_label_set_text(env, envStr);
  lv_obj_set_style_text_color(env, COLOR_MUTED, 0);
  lv_obj_align(env, LV_ALIGN_BOTTOM_MID, 0, -20);

  lv_scr_load(screenThermostat);
}

void showSoundScreen() {
  lv_obj_clean(screenSound);
  lv_obj_set_style_bg_color(screenSound, COLOR_BG, 0);

  // activeSource is hardware-detected reality (what's actually audible
  // right now); spotifyEnabled is the setting this screen's tap controls.
  // They're shown as two separate lines since they can disagree — e.g.
  // Spotify enabled=true but activeSource=override1 while the TV's on.
  lv_color_t sourceColor = state.activeSource == 1 ? COLOR_SPOTIFY
    : state.activeSource == 2 ? COLOR_ACCENT
    : state.activeSource == 3 ? COLOR_DANGER
    : COLOR_MUTED;

  lv_obj_t* arc = lv_arc_create(screenSound);
  lv_obj_set_size(arc, 260, 260);
  lv_arc_set_range(arc, 0, 100);
  lv_arc_set_value(arc, state.volumePercent);
  lv_obj_set_style_arc_color(arc, sourceColor, LV_PART_INDICATOR);
  lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
  lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_align(arc, LV_ALIGN_CENTER, 0, 0);

  char volStr[8];
  snprintf(volStr, sizeof(volStr), "%d%%", state.volumePercent);
  lv_obj_t* volLabel = lv_label_create(screenSound);
  lv_label_set_text(volLabel, volStr);
  lv_obj_set_style_text_font(volLabel, &lv_font_montserrat_48, 0);
  lv_obj_set_style_text_color(volLabel, COLOR_TEXT, 0);
  lv_obj_align(volLabel, LV_ALIGN_CENTER, 0, -10);

  const char* sourceLabel = state.activeSource == 1 ? "Spotify"
    : state.activeSource == 2 ? "TV"
    : state.activeSource == 3 ? "Priority Override"
    : "Off";
  lv_obj_t* src = lv_label_create(screenSound);
  lv_label_set_text(src, sourceLabel);
  lv_obj_set_style_text_color(src, sourceColor, 0);
  lv_obj_align(src, LV_ALIGN_CENTER, 0, 35);

  // Tap target for the Spotify enable gate — see onTap()'s SCREEN_SOUND
  // case. Whole screen is tappable already (LVGL's default indev on the
  // active screen), this label is just what that tap visually means here.
  char enabledStr[24];
  snprintf(enabledStr, sizeof(enabledStr), "Spotify: %s (tap)", state.spotifyEnabled ? "On" : "Off");
  lv_obj_t* enabledLabel = lv_label_create(screenSound);
  lv_label_set_text(enabledLabel, enabledStr);
  lv_obj_set_style_text_color(enabledLabel, state.spotifyEnabled ? COLOR_SPOTIFY : COLOR_MUTED, 0);
  lv_obj_align(enabledLabel, LV_ALIGN_BOTTOM_MID, 0, -20);

  lv_scr_load(screenSound);
}

// ── Display/touch driver init — PLACEHOLDER, confirm against real board ─
// The exact display controller (GC9A01/CO5300/etc.) and touch controller
// (CST816-family or similar) aren't knowable without the board's own
// datasheet/reference example in hand. Wire lv_disp_drv_t's flush_cb to
// that driver's write-pixels function and lv_indev_drv_t's read_cb to the
// touch controller's read function, following whatever board-support
// package/example the board vendor ships — this is the one part of this
// file that's structural scaffolding, not a working implementation.
void LVGL_DISPLAY_INIT() {
  lv_init();
  // TODO (bring-up): lv_disp_draw_buf_init(), lv_disp_drv_init(),
  // set disp_drv.flush_cb to the real panel driver, lv_disp_drv_register().
}

void LVGL_TOUCH_INIT() {
  // TODO (bring-up): lv_indev_drv_init(), set indev_drv.read_cb to the
  // real touch controller's read function (report x/y + pressed state,
  // and call onTap() on a press-then-release within a small movement
  // threshold so a drag doesn't register as a tap), lv_indev_drv_register().
}

// ── Setup ────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);

  Serial2.begin(RS485_BAUD, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);

  pinMode(ENCODER_PIN_A, INPUT_PULLUP);
  pinMode(ENCODER_PIN_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENCODER_PIN_A), onEncoderChange, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_PIN_B), onEncoderChange, CHANGE);
  if (ENCODER_BUTTON_PIN >= 0) pinMode(ENCODER_BUTTON_PIN, INPUT_PULLUP);

  uint64_t chipId = ESP.getEfuseMac();
  memcpy(uniqueId, &chipId, 6);
  uniqueId[6] = 0; uniqueId[7] = 0;

  loadAddressFromEEPROM();

  LVGL_DISPLAY_INIT();
  LVGL_TOUCH_INIT();

  screenIdle       = lv_obj_create(NULL);
  screenClock      = lv_obj_create(NULL);
  screenMenu       = lv_obj_create(NULL);
  screenThermostat = lv_obj_create(NULL);
  screenSound      = lv_obj_create(NULL);
  showIdleScreen();

  lastInteractionAt = millis();
  Serial.printf("[Dial] Boot complete. Address: %d\n", busAddress);
}

// ── Main loop ────────────────────────────────────────────────────────
void loop() {
  lv_timer_handler();
  pollSerial();
  processEncoder();
  checkIdleTimeout();

  if (busAddress == 0x00 && millis() - lastAnnounce >= ANNOUNCE_INTERVAL_MS) {
    lastAnnounce = millis();
    sendAnnounce();
  }
}
