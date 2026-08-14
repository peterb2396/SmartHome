/**
 * RS485 Wall Dial — Elecrow CrowPanel 2.1" ESP32-S3 Rotary Display
 * ─────────────────────────────────────────────────────────────────
 * Real hardware, now confirmed: Elecrow's CrowPanel 2.1"-HMI ESP32 Rotary
 * Display, 480x480 round IPS, capacitive touch + physical knob (rotate +
 * press). ESP32-S3, 8MB PSRAM, 16MB flash. Display is an ST7701 driving a
 * 480x480 RGB panel via Arduino_GFX's Arduino_ESP32RGBPanel bus; touch is
 * a CST8xx capacitive controller; touch reset/IRQ, LCD power/reset, and
 * the encoder's push-button are all behind a PCF8574 I2C GPIO expander at
 * address 0x21 rather than direct GPIOs.
 *
 * PIN NUMBERS BELOW ARE FROM ELECROW'S OWN WIKI (fetched during this
 * session, not measured against the board in hand) — cross-check against
 * the example sketch that ships with your unit / Elecrow's GitHub before
 * trusting them blindly; research turned up one internally-inconsistent
 * source page for the display bus timing constants specifically, resolved
 * here in favor of the two pages that agreed with each other, but "two
 * sources agreed" isn't the same as "confirmed against real silicon." The
 * RS485 module's UART pins are NOT documented anywhere Elecrow publishes
 * (it goes to whichever pins you wire on the board's UART expansion
 * header) — genuinely unknown, set RS485_RX_PIN/RS485_TX_PIN to whatever
 * you actually wire.
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
 * ── Faults/maintenance — deliberately non-blocking ─────────────────
 * A small ambient badge (see drawStatusBadge()) appears on the Clock,
 * Thermostat, and Sound screens whenever faultCount or
 * maintenanceDueCount is nonzero — glanceable, never a popup/modal, never
 * gates input. A 3rd menu item ("Status") shows the counts in more
 * detail, purely read-only. Every existing control (rotate to adjust
 * target/volume, tap to toggle Spotify) works completely unchanged
 * regardless of fault/maintenance state — this dial has no concept of
 * "locked out," by design, per explicit ask: it has to stay usable to
 * adjust a zone even mid-fault.
 *
 * ── Hardware ────────────────────────────────────────────────────────
 *   Elecrow CrowPanel 2.1"-HMI ESP32 Rotary Display (ESP32-S3, 480x480
 *     round IPS, ST7701 RGB panel, CST8xx touch, PCF8574 GPIO expander,
 *     physical knob with press)
 *   TTL-to-RS485 module (auto-direction assumed, same style as the sensor
 *     nodes — see rs485_node.ino's wiring section) wired to the board's
 *     UART expansion pins (exact numbers: yours to confirm, see above)
 *   LM2596 buck converter off the shared bus 24V feed, same as every
 *     other node — the CrowPanel's own USB-C input is 5V, separate from
 *     the RS485 bus's 24V feed; feed the buck converter's 5V output into
 *     whatever the board's 5V/VIN pad is, not through USB-C.
 *
 * ── Libraries (Arduino Library Manager) ────────────────────────────
 *   GFX Library for Arduino     by moononournation  (Arduino_GFX_Library)
 *   Adafruit CST8XX Library     — capacitive touch
 *   PCF8574 library             by Rob Tillaart (or equivalent)
 *   lvgl (v8.3.x)               — this file targets the v8 API
 *   EEPROM                      bundled with the ESP32 Arduino core
 *
 * ── Wiring / pins (from Elecrow's wiki — verify before flashing) ────
 *   RGB panel:  DE=40 VSYNC=7 HSYNC=15 PCLK=41 CS=16 SCK=2 SDA=1
 *               R0-R4=46,3,8,18,17   G0-G5=14,13,12,11,10,9
 *               B0-B4=5,45,48,47,21
 *   Touch/expander I2C: SDA=38 SCL=39 (PCF8574 @ 0x21: P0 touch reset,
 *               P2 touch IRQ, P3 LCD power, P4 LCD reset, P5 encoder button)
 *   Encoder:    A=42 B=4 (rotation, quadrature) — press comes via the
 *               PCF8574's P5 above, not a direct GPIO
 *   Backlight:  GPIO 6
 *   RS485 RX/TX: placeholders below — see header note, genuinely unknown
 *
 * ── Protocol integration (server/services/rs485.js — read that file's
 *    header comment for the authoritative spec) ──────────────────────
 * POLL_DIAL (0x04, master→dial, 27B): targetF, currentF, humidity, co2,
 * outdoorF (5x float32) + flags (1B: bit0 callingHeat, bit1 callingCool,
 * bit2 safetyActive, bit3 weatherStale, bit4 spotifyEnabled) + hour,
 * minute (1B each) + volumePercent, activeSource (1B each: 0=off,
 * 1=spotify,2=override1,3=override2) + faultCount, maintenanceDueCount
 * (1B each). activeSource is that zone's own audio hardware's CURRENT
 * hardware-detected input (a separate zoneAudio node, not this dial) —
 * display-only here, same as on the website; this dial has no say in
 * which input wins. faultCount/maintenanceDueCount are plain counts, same
 * numbers the Console/Maintenance pages show — this dial never renders
 * fault/maintenance text, just flags "go check the app" (see the Status
 * screen and drawStatusBadge()).
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
#include <Arduino_GFX_Library.h>
#include <Adafruit_CST8XX.h>
#include <PCF8574.h>
#include <lvgl.h>

// ── Config — confirm against real hardware during bring-up ─────────────
const int RS485_RX_PIN = 16; // GENUINELY UNKNOWN — set to whatever you wire on the UART expansion
const int RS485_TX_PIN = 17; // GENUINELY UNKNOWN — set to whatever you wire on the UART expansion
const unsigned long RS485_BAUD = 9600;

// RGB panel bus pins (Elecrow wiki — see header note on confidence)
const int TFT_DE = 40, TFT_VSYNC = 7, TFT_HSYNC = 15, TFT_PCLK = 41;
const int TFT_CS = 16, TFT_SCK = 2, TFT_SDA = 1;
const int TFT_R0 = 46, TFT_R1 = 3, TFT_R2 = 8, TFT_R3 = 18, TFT_R4 = 17;
const int TFT_G0 = 14, TFT_G1 = 13, TFT_G2 = 12, TFT_G3 = 11, TFT_G4 = 10, TFT_G5 = 9;
const int TFT_B0 = 5, TFT_B1 = 45, TFT_B2 = 48, TFT_B3 = 47, TFT_B4 = 21;
const int BACKLIGHT_PIN = 6;

const int I2C_SDA_PIN = 38, I2C_SCL_PIN = 39;
const uint8_t PCF8574_ADDR = 0x21;
const uint8_t PCF_TOUCH_RESET = 0, PCF_TOUCH_IRQ = 2, PCF_LCD_POWER = 3, PCF_LCD_RESET = 4, PCF_ENCODER_BTN = 5;

const int ENCODER_PIN_A = 42;
const int ENCODER_PIN_B = 4;

const unsigned long ANNOUNCE_INTERVAL_MS = 5000;
const unsigned long POLL_TIMEOUT_HINT_MS = 200; // matches DIAL_POLL_RESPONSE_TIMEOUT_MS server-side
const unsigned long IDLE_TIMEOUT_MS = 20000;    // no interaction -> back to IDLE (screen off)
const unsigned long MENU_TIMEOUT_MS = 8000;     // no interaction on the menu -> back to IDLE

const float TARGET_MIN_F = 60, TARGET_MAX_F = 75; // matches thermostat.js's safety range
const float TARGET_STEP_F = 0.5;
const int VOLUME_STEP = 2;

const unsigned long EEPROM_SIZE = 8;
const int EEPROM_ADDR_BYTE = 0;

// ── Colors — mirrors web/src/styles/tokens.js so the dial's screens read
// as the same product as the website, not a separate one ────────────────
#define COLOR_BG        lv_color_hex(0xF8FAFC)
#define COLOR_CARD      lv_color_hex(0xFFFFFF)
#define COLOR_TEXT      lv_color_hex(0x1E293B)
#define COLOR_MUTED     lv_color_hex(0x64748B)
#define COLOR_ACCENT    lv_color_hex(0x3B82F6)
#define COLOR_HEAT      lv_color_hex(0xFB923C) // calling-heat orange, matches ZoneCard.jsx
#define COLOR_COOL      lv_color_hex(0x60A5FA) // calling-cool blue
#define COLOR_DANGER    lv_color_hex(0xEF4444) // safety override red / fault
#define COLOR_WARNING   lv_color_hex(0xF59E0B) // maintenance due
#define COLOR_SPOTIFY   lv_color_hex(0x1DB954)
#define COLOR_SUCCESS   lv_color_hex(0x10B981)

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

// ── Display/touch/expander global objects — declared here (not down by
// LVGL_DISPLAY_INIT()/LVGL_TOUCH_INIT()) so every function below,
// including checkEncoderButton(), can see them. Arduino's build step
// auto-prototypes functions but NOT global objects, so this one has to be
// in real source order. GFX Library for Arduino's RGB-panel bus, matched
// to the ST7701 panel this board uses — timing constants (porches/pulse
// width/pclk) are the values from Elecrow's own reference sketch, see
// this file's header on confidence. ─────────────────────────────────────
Arduino_ESP32RGBPanel* rgbBus = new Arduino_ESP32RGBPanel(
  TFT_DE, TFT_VSYNC, TFT_HSYNC, TFT_PCLK,
  TFT_R0, TFT_R1, TFT_R2, TFT_R3, TFT_R4,
  TFT_G0, TFT_G1, TFT_G2, TFT_G3, TFT_G4, TFT_G5,
  TFT_B0, TFT_B1, TFT_B2, TFT_B3, TFT_B4,
  0 /* hsync_polarity */, 20 /* hsync_front_porch */, 10 /* hsync_pulse_width */, 10 /* hsync_back_porch */,
  0 /* vsync_polarity */, 8 /* vsync_front_porch */, 10 /* vsync_pulse_width */, 10 /* vsync_back_porch */,
  1 /* pclk_active_neg */, 16000000 /* prefer_speed */
);
Arduino_GFX* gfx = new Arduino_ST7701_RGBPanel(
  rgbBus, GFX_NOT_DEFINED /* RST — behind PCF8574, see LVGL_DISPLAY_INIT() */, 0 /* rotation */,
  false /* IPS */, 480, 480
);

PCF8574 pcf8574(PCF8574_ADDR);
Adafruit_CST8XX touch;

static lv_disp_draw_buf_t drawBuf;
static lv_color_t* lvBuf1;
static lv_disp_drv_t dispDrv;
static lv_indev_drv_t indevDrv;

// ── Local live state — updated from POLL_DIAL pushes, and by the encoder
// between pushes; DIAL_STATE always reports these absolute values back ──
struct DialState {
  float targetF = 68, currentF = 0, humidity = 0, co2 = 0, outdoorF = 0;
  bool callingHeat = false, callingCool = false, safetyActive = false, weatherStale = true;
  uint8_t hour = 0, minute = 0;
  uint8_t volumePercent = 0;
  uint8_t activeSource = 0;    // 0=off,1=spotify,2=override1,3=override2 — hardware-detected, read-only here
  bool spotifyEnabled = false; // this dial's own optimistic copy — see onTap()'s SCREEN_SOUND case
  uint8_t faultCount = 0;
  uint8_t maintenanceDueCount = 0;
} state;

bool pendingChange = false;   // set when the encoder has moved something since the last poll reply
uint8_t pendingTapEvent = 0;  // 0=none,1=wake,2=menuSelect,3=toggleSpotifyEnabled

// ── Screen state machine ────────────────────────────────────────────────
enum Screen { SCREEN_IDLE, SCREEN_CLOCK, SCREEN_MENU, SCREEN_THERMOSTAT, SCREEN_SOUND, SCREEN_STATUS };
Screen currentScreen = SCREEN_IDLE;
const int MENU_ITEM_COUNT = 3; // Sound, Thermostat, Status
int menuSelection = 0;         // cycled by rotating on SCREEN_MENU
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
  if (len < 27) return;
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
  state.faultCount = p[25];
  state.maintenanceDueCount = p[26];
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

// Resync safety net — same fix, same reasoning, as rs485_node.ino's
// pollSerial(); see that file's comment for the full explanation. Without
// this, a single noise glitch permanently wedges this node's receiver
// until power-cycled, indistinguishable from a dead node to the master.
const uint8_t MAX_PAYLOAD_LEN = 32; // largest real payload today is POLL_DIAL's 27B
const unsigned long FRAME_STALL_MS = 500;
bool awaitingFrame = false;
unsigned long awaitingFrameSince = 0;

void pollSerial() {
  while (Serial2.available()) {
    if (rxLen < sizeof(rxBuf)) rxBuf[rxLen++] = Serial2.read();
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
// so it can safely touch LVGL/state. Unconditional regardless of
// faultCount/maintenanceDueCount — see this file's header on why this
// dial never gates input on fault/maintenance state.
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
      menuSelection = (menuSelection + (delta > 0 ? 1 : -1) + MENU_ITEM_COUNT) % MENU_ITEM_COUNT;
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
    default: break; // STATUS screen is read-only, rotating there does nothing
  }
}

// ── Touch wake / tap handling ────────────────────────────────────────────
// LVGL_TOUCH_INIT() below feeds LVGL's own input device driver, which is
// what actually detects taps for widgets on-screen. This handles the
// things that aren't a normal LVGL widget tap: waking from IDLE,
// confirming a MENU selection, and the Sound screen's Spotify toggle. The
// PCF8574's encoder-button pin (checkEncoderButton()) also calls this, so
// a physical press does the same thing a touchscreen tap does everywhere
// in this UI — one gesture, two ways to trigger it.
void onTap() {
  lastInteractionAt = millis();
  if (currentScreen == SCREEN_IDLE) {
    currentScreen = SCREEN_CLOCK;
    pendingTapEvent = 1; // wake
    showClockScreen();
  } else if (currentScreen == SCREEN_MENU) {
    pendingTapEvent = 2; // menuSelect
    if (menuSelection == 0) { currentScreen = SCREEN_SOUND; showSoundScreen(); }
    else if (menuSelection == 1) { currentScreen = SCREEN_THERMOSTAT; showThermostatScreen(); }
    else { currentScreen = SCREEN_STATUS; showStatusScreen(); }
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
  } else if (currentScreen == SCREEN_STATUS) {
    // Read-only screen — a tap here just backs out to the menu rather
    // than doing nothing, so it's not a dead end.
    currentScreen = SCREEN_MENU;
    showMenuScreen();
  }
}

// Physical knob press, read via the PCF8574 expander (not a direct GPIO —
// see this file's header). Polled, not interrupt-driven: PCF8574 has an
// IRQ pin per-expander, not per-button, and touch already uses the same
// expander's IRQ line for its own purpose — simple edge-detected polling
// here avoids sharing/muxing that interrupt for a control that only needs
// to feel responsive, not real-time.
bool lastEncoderBtnState = true; // PCF8574 INPUT_PULLUP convention: HIGH = released
void checkEncoderButton() {
  bool pressed = pcf8574.read(PCF_ENCODER_BTN) == LOW;
  if (pressed && lastEncoderBtnState) onTap(); // falling edge only
  lastEncoderBtnState = !pressed;
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
    case SCREEN_STATUS:      showStatusScreen();      break;
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
lv_obj_t* screenStatus;

// Small ambient corner badge — never blocks or covers the screen's main
// content, just a glanceable "something needs attention, check the app"
// indicator. Called from every screen except IDLE/MENU/STATUS (STATUS
// already shows the detail; MENU/IDLE keep it out to stay uncluttered —
// the badge's whole job is being visible on the screens someone's
// actually using to control something).
void drawStatusBadge(lv_obj_t* parent) {
  if (state.faultCount == 0 && state.maintenanceDueCount == 0) return;
  lv_color_t badgeColor = state.faultCount > 0 ? COLOR_DANGER : COLOR_WARNING;

  lv_obj_t* dot = lv_obj_create(parent);
  lv_obj_set_size(dot, 14, 14);
  lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(dot, badgeColor, 0);
  lv_obj_set_style_border_width(dot, 0, 0);
  lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_align(dot, LV_ALIGN_TOP_MID, 0, 14);
}

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

  drawStatusBadge(screenClock);
  lv_scr_load(screenClock);
}

void showMenuScreen() {
  lv_obj_clean(screenMenu);
  lv_obj_set_style_bg_color(screenMenu, COLOR_BG, 0);

  const char* labels[MENU_ITEM_COUNT] = { "Sound", "Thermostat", "Status" };
  const int ySpacing = 45;
  for (int i = 0; i < MENU_ITEM_COUNT; i++) {
    lv_obj_t* item = lv_label_create(screenMenu);
    lv_label_set_text(item, labels[i]);
    lv_obj_set_style_text_font(item, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(item, i == menuSelection ? COLOR_ACCENT : COLOR_MUTED, 0);
    lv_obj_align(item, LV_ALIGN_CENTER, 0, (i - 1) * ySpacing);
    // "Status" menu item itself gets a tiny dot next to it when something's
    // due, so it's visible while still in the menu, not just after
    // navigating in — same non-blocking badge, smaller.
    if (i == 2 && (state.faultCount > 0 || state.maintenanceDueCount > 0)) {
      lv_obj_t* dot = lv_obj_create(screenMenu);
      lv_obj_set_size(dot, 10, 10);
      lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
      lv_obj_set_style_bg_color(dot, state.faultCount > 0 ? COLOR_DANGER : COLOR_WARNING, 0);
      lv_obj_set_style_border_width(dot, 0, 0);
      lv_obj_align_to(dot, item, LV_ALIGN_OUT_RIGHT_MID, 8, 0);
    }
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

  drawStatusBadge(screenThermostat);
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

  drawStatusBadge(screenSound);
  lv_scr_load(screenSound);
}

// Read-only — counts only, see this file's header on why no fault/
// maintenance text is rendered here. All-clear state shown in green so
// checking this screen is reassuring, not just an alert surface.
void showStatusScreen() {
  lv_obj_clean(screenStatus);
  lv_obj_set_style_bg_color(screenStatus, COLOR_BG, 0);

  bool allClear = state.faultCount == 0 && state.maintenanceDueCount == 0;

  lv_obj_t* icon = lv_label_create(screenStatus);
  lv_label_set_text(icon, allClear ? LV_SYMBOL_OK : LV_SYMBOL_WARNING);
  lv_obj_set_style_text_font(icon, &lv_font_montserrat_48, 0);
  lv_obj_set_style_text_color(icon, allClear ? COLOR_SUCCESS : COLOR_DANGER, 0);
  lv_obj_align(icon, LV_ALIGN_CENTER, 0, -70);

  if (allClear) {
    lv_obj_t* label = lv_label_create(screenStatus);
    lv_label_set_text(label, "All normal");
    lv_obj_set_style_text_font(label, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(label, COLOR_TEXT, 0);
    lv_obj_align(label, LV_ALIGN_CENTER, 0, -10);
  } else {
    char faultStr[24];
    snprintf(faultStr, sizeof(faultStr), "%d fault%s", state.faultCount, state.faultCount == 1 ? "" : "s");
    lv_obj_t* faultLabel = lv_label_create(screenStatus);
    lv_label_set_text(faultLabel, faultStr);
    lv_obj_set_style_text_font(faultLabel, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(faultLabel, state.faultCount > 0 ? COLOR_DANGER : COLOR_MUTED, 0);
    lv_obj_align(faultLabel, LV_ALIGN_CENTER, 0, -20);

    char maintStr[32];
    snprintf(maintStr, sizeof(maintStr), "%d maintenance due", state.maintenanceDueCount);
    lv_obj_t* maintLabel = lv_label_create(screenStatus);
    lv_label_set_text(maintLabel, maintStr);
    lv_obj_set_style_text_font(maintLabel, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(maintLabel, state.maintenanceDueCount > 0 ? COLOR_WARNING : COLOR_MUTED, 0);
    lv_obj_align(maintLabel, LV_ALIGN_CENTER, 0, 20);

    lv_obj_t* hint = lv_label_create(screenStatus);
    lv_label_set_text(hint, "See the app for details");
    lv_obj_set_style_text_color(hint, COLOR_MUTED, 0);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -20);
  }

  lv_scr_load(screenStatus);
}

// ── Display/touch driver init ────────────────────────────────────────
void displayFlushCb(lv_disp_drv_t* disp, const lv_area_t* area, lv_color_t* colorP) {
  uint32_t w = area->x2 - area->x1 + 1;
  uint32_t h = area->y2 - area->y1 + 1;
  gfx->draw16bitRGBBitmap(area->x1, area->y1, (uint16_t*)colorP, w, h);
  lv_disp_flush_ready(disp);
}

bool touchPressed = false;
void touchpadReadCb(lv_indev_drv_t* indevDriver, lv_indev_data_t* data) {
  if (touch.touched()) {
    CST_TS_Point p = touch.getPoint(0);
    data->point.x = p.x;
    data->point.y = p.y;
    data->state = LV_INDEV_STATE_PR;
    touchPressed = true;
  } else {
    data->state = LV_INDEV_STATE_REL;
    // Register the tap on release, matching a normal button-press feel —
    // onTap() drives navigation/toggles above, LVGL's own widget tap
    // handling (e.g. eventually a real button widget) can coexist with
    // this for screens that don't need it.
    if (touchPressed) onTap();
    touchPressed = false;
  }
}

void LVGL_DISPLAY_INIT() {
  lv_init();

  // Touch/LCD reset and power sequencing lives behind the PCF8574 — pulse
  // LCD power+reset before the panel starts clocking data out.
  pcf8574.begin();
  pcf8574.write(PCF_LCD_POWER, HIGH);
  pcf8574.write(PCF_LCD_RESET, LOW);
  delay(20);
  pcf8574.write(PCF_LCD_RESET, HIGH);
  delay(120);

  pinMode(BACKLIGHT_PIN, OUTPUT);
  digitalWrite(BACKLIGHT_PIN, HIGH);

  gfx->begin();
  gfx->fillScreen(BLACK);

  static const uint32_t bufPixels = 480 * 40; // partial buffer — full 480x480x2B (450KB) doesn't fit typical LVGL config; PSRAM makes this comfortable
  lvBuf1 = (lv_color_t*)heap_caps_malloc(bufPixels * sizeof(lv_color_t), MALLOC_CAP_SPIRAM);
  lv_disp_draw_buf_init(&drawBuf, lvBuf1, NULL, bufPixels);

  lv_disp_drv_init(&dispDrv);
  dispDrv.hor_res = 480;
  dispDrv.ver_res = 480;
  dispDrv.flush_cb = displayFlushCb;
  dispDrv.draw_buf = &drawBuf;
  lv_disp_drv_register(&dispDrv);
}

void LVGL_TOUCH_INIT() {
  // Touch reset/IRQ also live behind the PCF8574 (see this file's header).
  pcf8574.write(PCF_TOUCH_RESET, LOW);
  delay(10);
  pcf8574.write(PCF_TOUCH_RESET, HIGH);
  delay(50);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  touch.begin();

  lv_indev_drv_init(&indevDrv);
  indevDrv.type = LV_INDEV_TYPE_POINTER;
  indevDrv.read_cb = touchpadReadCb;
  lv_indev_drv_register(&indevDrv);
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

  uint64_t chipId = ESP.getEfuseMac();
  memcpy(uniqueId, &chipId, 6);
  uniqueId[6] = 0; uniqueId[7] = 0;

  loadAddressFromEEPROM();

  LVGL_DISPLAY_INIT();
  LVGL_TOUCH_INIT(); // after LVGL_DISPLAY_INIT() — shares the PCF8574 it initializes

  screenIdle       = lv_obj_create(NULL);
  screenClock      = lv_obj_create(NULL);
  screenMenu       = lv_obj_create(NULL);
  screenThermostat = lv_obj_create(NULL);
  screenSound      = lv_obj_create(NULL);
  screenStatus     = lv_obj_create(NULL);
  showIdleScreen();

  lastInteractionAt = millis();
  Serial.printf("[Dial] Boot complete. Address: %d\n", busAddress);
}

// ── Main loop ────────────────────────────────────────────────────────
void loop() {
  lv_timer_handler();
  pollSerial();
  processEncoder();
  checkEncoderButton();
  checkIdleTimeout();

  if (busAddress == 0x00 && millis() - lastAnnounce >= ANNOUNCE_INTERVAL_MS) {
    lastAnnounce = millis();
    sendAnnounce();
  }
}
