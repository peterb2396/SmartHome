/**
 * Wall Dial — Elecrow CrowPanel 2.1" ESP32-S3 Rotary Display
 * ─────────────────────────────────────────────────────────────────
 * This board is a pure I2C PERIPHERAL — it carries NO RS485 logic at all
 * and doesn't need to know that bus exists. It's an accessory of a
 * standard mass-produced RS485 sensor node (server/rs485-nodes/
 * rs485_node.ino), exactly like that node's BME680/SCD41 sensors are —
 * connected via the SAME I2C bus, GND, and 5V rail as those sensors, at
 * its own fixed address (DIAL_I2C_ADDR). That RP2040 board is the one
 * that actually speaks RS485 to the Pi; it relays POLL_DIAL pushes to
 * this dial over I2C and relays this dial's reply back — a byte-for-byte
 * proxy (see rs485_node.ino's bridgeDialPoll()), so the two payload
 * structs below are the ONLY protocol contract this file has with
 * anything else, and they're identical to what used to go over RS485
 * directly. No bus address, no commissioning, no ANNOUNCE/ASSIGN — this
 * board's I2C address is just a fixed constant.
 *
 * PIN NUMBERS, the RGB/ST7701 panel construction, the PCF8574 reset/power
 * sequence, and the touch init below are matched against Elecrow's own
 * confirmed-working example for this exact board (RotaryScreen_2_1.ino,
 * github.com/Elecrow-RD/CrowPanel-2.1inch-HMI-ESP32-Rotary-Display-480-480-
 * IPS-Round-Touch-Knob-Screen) — not guessed. The SECOND I2C bus
 * (DIAL_I2C_SDA_PIN/DIAL_I2C_SCL_PIN, the link to the RP2040 node) is this
 * file's own addition, absent from Elecrow's example, and is still on
 * GENUINELY UNKNOWN pins — this board's other pins already consume most of
 * the ESP32-S3's GPIOs (display bus + encoder + backlight + the display's
 * OWN internal I2C for touch/expander), so confirm two truly free GPIOs
 * against your specific board variant before wiring this.
 *
 * ── Faults/maintenance — deliberately non-blocking ─────────────────
 * A small ambient badge (see drawStatusBadge()) appears on the Clock,
 * Thermostat, and Music Volume (internally still SCREEN_SOUND/"sound" in
 * identifiers — only the user-facing menu label changed, see
 * showMenuScreen()) screens whenever faultCount or maintenanceDueCount is
 * nonzero — glanceable, never a popup/modal, never gates input. The menu
 * only ever has 2 items (Music Volume, Thermostat) under
 * normal conditions — a 3rd item ("Status") appears ONLY while faultCount
 * or maintenanceDueCount is nonzero (see statusItemVisible()/
 * menuItemCount()), so there's nothing to check when nothing's wrong.
 * Status shows the counts in detail; faults are read-only there (they
 * clear on their own once the underlying condition resolves — see
 * faults.js), but a "Mark Done" button lets maintenance be cleared right
 * from the dial when something's due (see maintenanceDoneBtnEventCb()) —
 * the one tapEvent this dial sends that's actually acted on server-side
 * outside of the Spotify toggle. Every existing control (rotate to adjust
 * target/volume, tap to toggle Spotify) works completely unchanged
 * regardless of fault/maintenance state — this dial has no concept of
 * "locked out," by design, per explicit ask: it has to stay usable to
 * adjust a zone even mid-fault.
 *
 * ── Hardware ────────────────────────────────────────────────────────
 *   Elecrow CrowPanel 2.1"-HMI ESP32 Rotary Display (ESP32-S3, 480x480
 *     round IPS, ST7701 RGB panel, CST8xx touch, PCF8574 GPIO expander,
 *     physical knob with press)
 *   No separate transceiver/step-down needed on this board — 5V, GND, and
 *     I2C all come from the paired RP2040 node's existing LM2596 + bus
 *     wiring (see rs485_node.ino's wiring section for its side of this).
 *     The CrowPanel's own USB-C input can still be used for
 *     flashing/debugging, but isn't the intended power source in the
 *     field.
 *
 * ── Libraries (Arduino Library Manager) ────────────────────────────
 *   GFX Library for Arduino     by moononournation  (Arduino_GFX_Library)
 *   Adafruit CST8XX Library     — capacitive touch
 *   PCF8574 library             by Rob Tillaart (or equivalent)
 *   lvgl (v9.x)                 — this file targets the v9 display/indev
 *                                 registration API (lv_display_t*lv_indev_t*
 *                                 handles, not v8's lv_disp_drv_t structs) —
 *                                 confirmed against an actual installed
 *                                 v9.1.0 during bring-up, not assumed
 *
 * ── Wiring / pins (from Elecrow's wiki — verify before flashing) ────
 *   RGB panel:  DE=40 VSYNC=7 HSYNC=15 PCLK=41 CS=16 SCK=2 SDA=1
 *               R0-R4=46,3,8,18,17   G0-G5=14,13,12,11,10,9
 *               B0-B4=5,45,48,47,21
 *   Touch/expander I2C (Wire0, internal to this board only): SDA=38
 *               SCL=39 (PCF8574 @ 0x21: P0 touch reset, P2 touch IRQ,
 *               P3 LCD power, P4 LCD reset, P5 encoder button)
 *   Encoder:    A=42 B=4 (rotation, quadrature) — press comes via the
 *               PCF8574's P5 above, not a direct GPIO
 *   Backlight:  GPIO 6
 *   RP2040 link (Wire1, slave mode — GENUINELY UNKNOWN, pick 2 free
 *               GPIOs): SDA=DIAL_I2C_SDA_PIN SCL=DIAL_I2C_SCL_PIN, plus
 *               shared GND and 5V from the RP2040 node's LM2596
 *
 * ── I2C protocol (must match rs485_node.ino's DIAL_I2C_ADDR/
 *    DIAL_PUSH_LEN/DIAL_REPLY_LEN, and rs485.js's POLL_DIAL/DIAL_STATE —
 *    see that file's header for the authoritative spec) ────────────────
 * Push (RP2040 write, 27B): targetF, currentF, humidity, co2, outdoorF
 * (5x float32) + flags (1B: bit0 callingHeat, bit1 callingCool, bit2
 * safetyActive, bit3 weatherStale, bit4 spotifyEnabled) + hour, minute
 * (1B each) + volumePercent, activeSource (1B each: 0=off,1=spotify,
 * 2=override1,3=override2) + faultCount, maintenanceDueCount (1B each).
 * activeSource is that zone's own audio hardware's CURRENT
 * hardware-detected input (a separate zoneAudio node) — display-only
 * here; this dial has no say in which input wins. faultCount/
 * maintenanceDueCount are plain counts for an ambient badge — this dial
 * never renders fault/maintenance TEXT, just flags "go check the app."
 *
 * Reply (RP2040 read, 8B): mode (1B: 0=thermostat, 1=sound) + newTargetF
 * (float32) + changed (1B) + tapEvent (1B) + newVolumePercent (1B).
 * newTargetF/newVolumePercent are always this board's own locally-tracked
 * ABSOLUTE values (never deltas) — the push carries the current value
 * down every cycle specifically so a dropped exchange can't cause drift;
 * this board just keeps incrementing its local copy from encoder turns
 * and reports where it currently sits.
 * tapEvent: 0=none, 1=wake, 2=menuSelect, 4=returnToMenu (tapped/pressed
 * on Thermostat or Status — purely local navigation, never acted on
 * server-side). 3=toggle Spotify-enabled for this dial's sound zone —
 * only acted on when mode=sound. That's strictly a Spotify on/off gate;
 * it never touches override inputs. 5=markMaintenanceDone — the Status
 * screen's "Mark Done" button (only shown while maintenanceDueCount > 0);
 * acted on server-side regardless of mode, see rs485.js's pollAllDials().
 */

#include <Wire.h>
#include <Arduino_GFX_Library.h>
#include <Adafruit_CST8XX.h>
#include <PCF8574.h>
#include <lvgl.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>

// ── Remote firmware update (WiFi/HTTP, NOT the RS485 protocol the RP2040
// nodes use) ─────────────────────────────────────────────────────────
// This board has no RS485/I2C path back to the Pi at all — it's a pure
// I2C peripheral of its paired RP2040 node (see this file's header), so
// it can't be pushed to the way rs485_node.ino/zone_audio_node.ino are.
// It DOES have real WiFi hardware on-chip (every ESP32-S3 does, this
// isn't board-variant-dependent), so it pulls its own updates instead —
// see checkForOTA() below.
//
// Real credentials live in secrets.h, NOT here — that file is gitignored
// (source_code/server/rs485-nodes/secrets.h) so the real WiFi password
// never enters git history. See secrets.h.example for the template; copy
// it to secrets.h alongside wherever you actually compile this .ino from
// (a plain copy-paste of just this file won't carry secrets.h with it).
#include "secrets.h"
const char* WIFI_SSID = WIFI_SSID_SECRET;
const char* WIFI_PASSWORD = WIFI_PASSWORD_SECRET;
const char* OTA_SERVER_HOST = "server.153home.online"; // same host the rest of this app already uses — reachable from the LAN, no need to know the Pi's local IP
// Bump this alongside uploading a NEW file named dial-<version>.bin via
// the Console's firmware panel — see server/services/firmwareUpdate.js's
// getLatestDialFirmware() for the exact naming convention this is
// compared against.
const char* FIRMWARE_VERSION = "1.0.0";
const unsigned long OTA_CHECK_INTERVAL_MS = 6UL * 60 * 60 * 1000; // every 6 hours
const unsigned long OTA_FIRST_CHECK_DELAY_MS = 30000; // wait until well after boot — see checkForOTA()'s comment on why this blocks loop()
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 8000; // don't hang indefinitely if WiFi's unavailable

// ── Config — confirm against real hardware during bring-up ─────────────
// RGB panel bus pins (Elecrow wiki — see header note on confidence)
const int TFT_DE = 40, TFT_VSYNC = 7, TFT_HSYNC = 15, TFT_PCLK = 41;
const int TFT_CS = 16, TFT_SCK = 2, TFT_SDA = 1;
const int TFT_R0 = 46, TFT_R1 = 3, TFT_R2 = 8, TFT_R3 = 18, TFT_R4 = 17;
const int TFT_G0 = 14, TFT_G1 = 13, TFT_G2 = 12, TFT_G3 = 11, TFT_G4 = 10, TFT_G5 = 9;
const int TFT_B0 = 5, TFT_B1 = 45, TFT_B2 = 48, TFT_B3 = 47, TFT_B4 = 21;
const int BACKLIGHT_PIN = 6;

const int I2C_SDA_PIN = 38, I2C_SCL_PIN = 39; // Wire0 — internal only (touch + PCF8574)
const uint8_t PCF8574_ADDR = 0x21;
const uint8_t TOUCH_I2C_ADDR = 0x15; // per Elecrow's own example: "often but not always 0x15!" — confirm if touch doesn't respond
const uint8_t PCF_TOUCH_RESET = 0, PCF_TOUCH_IRQ = 2, PCF_LCD_POWER = 3, PCF_LCD_RESET = 4, PCF_ENCODER_BTN = 5;

const int ENCODER_PIN_A = 42;
const int ENCODER_PIN_B = 4;

// GENUINELY UNKNOWN — see this file's header. Wire1, slave mode, the link
// to the paired RP2040 node.
const int DIAL_I2C_SDA_PIN = 43;
const int DIAL_I2C_SCL_PIN = 44;
const uint8_t DIAL_I2C_ADDR = 0x42; // MUST match rs485_node.ino's DIAL_I2C_ADDR
const uint8_t DIAL_PUSH_LEN = 27;   // MUST match rs485.js's POLL_DIAL payload size
const uint8_t DIAL_REPLY_LEN = 8;   // MUST match rs485.js's DIAL_STATE payload size

const unsigned long IDLE_TIMEOUT_MS = 20000; // no interaction -> back to IDLE (screen off)
const unsigned long MENU_TIMEOUT_MS = 8000;  // no interaction on the menu -> back to IDLE

const float TARGET_MIN_F = 60, TARGET_MAX_F = 75; // matches thermostat.js's safety range
const float TARGET_STEP_F = 1.0; // was 0.5 — the displayed number rounds to whole degrees ("%.0f"), so a half-degree step made the arc visibly move twice per one visible number change
const int VOLUME_STEP = 2;

// ── Colors — mirrors web/src/styles/tokens.js so the dial's screens read
// as the same product as the website, not a separate one ────────────────
// Light beige / light blue theme, as asked for directly — warm neutral
// background+card+track, cool light blue for the accent/interactive
// color. Semantic colors (HEAT/DANGER/WARNING/SPOTIFY/SUCCESS) untouched
// on purpose — those carry real meaning (red=danger, green=success),
// changing them wasn't part of the ask.
#define COLOR_BG        lv_color_hex(0xF5EFE6) // light beige
#define COLOR_CARD      lv_color_hex(0xFFFBF5) // warm off-white
#define COLOR_TEXT      lv_color_hex(0x3D3833) // warm dark brown-gray, not cool slate
#define COLOR_MUTED     lv_color_hex(0x8A8172)
#define COLOR_ACCENT    lv_color_hex(0x5B9BD5) // light blue
#define COLOR_HEAT      lv_color_hex(0xFB923C) // calling-heat orange, matches ZoneCard.jsx
#define COLOR_COOL      lv_color_hex(0x60A5FA) // calling-cool blue
#define COLOR_DANGER    lv_color_hex(0xEF4444) // safety override red / fault
#define COLOR_WARNING   lv_color_hex(0xF59E0B) // maintenance due
#define COLOR_SPOTIFY   lv_color_hex(0x1DB954)
#define COLOR_SUCCESS   lv_color_hex(0x10B981)
#define COLOR_TRACK     lv_color_hex(0xE6DCC8) // arc's unfilled background track, warmed to match the beige theme

const uint8_t MODE_THERMOSTAT = 0;
const uint8_t MODE_SOUND = 1;

// ── Display/touch/expander global objects — declared here (not down by
// LVGL_DISPLAY_INIT()/LVGL_TOUCH_INIT()) so every function below,
// including checkEncoderButton(), can see them. Arduino's build step
// auto-prototypes functions but NOT global objects, so this one has to be
// in real source order.
//
// Matched against a NEWER copy of Elecrow's own RotaryScreen_2_1.ino (the
// user's local upload, more current than what an earlier GitHub fetch this
// session returned — this repo has genuinely moved under us more than
// once) using Arduino_RGB_Display, which matches the class actually
// present in the installed library. Two real gaps this closed, both of
// which plausibly explain "everything renders correctly per software but
// the physical screen stays black": (1) a separate 3-wire SPI bus IS
// needed to carry the ST7701's one-time register init sequence — an
// earlier revision of this file wrongly passed NULL for it, assuming the
// init rode over the RGB interface itself; TFT_CS/TFT_SCK/TFT_SDA (already
// declared above) are exactly what this bus needs and were sitting unused.
// (2) hsync/vsync polarity is 1, not 0, and a DMA bounce buffer + explicit
// pixel clock are required, not optional defaults.
Arduino_DataBus* panelInitBus = new Arduino_SWSPI(
  GFX_NOT_DEFINED /* DC — ST7701 uses 9-bit SPI, no separate D/C line */,
  TFT_CS, TFT_SCK, TFT_SDA, GFX_NOT_DEFINED /* MISO */
);
// R/B channel args deliberately swapped below (TFT_B* into the r0-r4
// slots, TFT_R* into the b0-b4 slots) — confirmed by an actual on-panel
// test (solid red/green/blue blocks): green rendered correctly, red and
// blue rendered exactly swapped. The MADCTL BGR bit didn't fix this
// because that command governs the SPI/MCU pixel-write path, not the
// continuous DMA'd RGB video interface this board actually streams pixels
// over — swapping the physical channel mapping here is the layer that
// actually controls it for an RGB-interface panel like this one.
Arduino_ESP32RGBPanel* rgbBus = new Arduino_ESP32RGBPanel(
  TFT_DE, TFT_VSYNC, TFT_HSYNC, TFT_PCLK,
  TFT_B0, TFT_B1, TFT_B2, TFT_B3, TFT_B4,
  TFT_G0, TFT_G1, TFT_G2, TFT_G3, TFT_G4, TFT_G5,
  TFT_R0, TFT_R1, TFT_R2, TFT_R3, TFT_R4,
  1 /* hsync_polarity */, 10 /* hsync_front_porch */, 4 /* hsync_pulse_width */, 20 /* hsync_back_porch */,
  1 /* vsync_polarity */, 10 /* vsync_front_porch */, 4 /* vsync_pulse_width */, 20 /* vsync_back_porch */,
  0 /* pclk_active_neg */, 12000000 /* prefer_speed / pixel clock */, false /* useBigEndian */,
  0 /* de_idle_high */, 0 /* pclk_idle_high */,
  480 * 20 /* bounce_buffer_size_px — two internal DMA bounce buffers, 20 lines each */
);
Arduino_RGB_Display* gfx = new Arduino_RGB_Display(
  480 /* width */, 480 /* height */, rgbBus, 0 /* rotation */, true /* auto_flush */,
  panelInitBus, GFX_NOT_DEFINED /* RST — behind PCF8574, see LVGL_DISPLAY_INIT() */,
  st7701_type5_init_operations, sizeof(st7701_type5_init_operations)
);

PCF8574 pcf8574(PCF8574_ADDR);
Adafruit_CST8XX touch;

// LVGL v9 API (confirmed against the actual installed lvgl 9.1.0 headers —
// lv_display_t*/lv_indev_t* opaque handles, not the v8 lv_disp_drv_t/
// lv_indev_drv_t structs this file originally targeted; the whole point of
// this file's original "targets v8.3.x" header note, since v9 changed this
// registration API significantly).
// uint8_t*, not lv_color_t* — in LVGL v9, lv_color_t is a 3-byte RGB888
// struct (confirmed in the installed lv_color.h) used for STYLING calls
// (lv_color_hex() etc.), unrelated to the raw display buffer's actual
// pixel format. The buffer itself needs to match whatever color format
// the display is set to (RGB565, 2B/pixel, set explicitly below) — sizing
// it with sizeof(lv_color_t) would have been wrong by 1 byte/pixel.
static uint8_t* lvBuf1;
lv_display_t* lvDisplay;
lv_indev_t* lvIndev;

// Screen objects — declared here (not down by their show*Screen()
// functions) so onTap()/checkEncoderButton() above can reference them
// directly (Arduino only auto-forward-declares FUNCTIONS, not globals).
lv_obj_t* screenIdle;
lv_obj_t* screenClock;
lv_obj_t* screenMenu;
lv_obj_t* screenThermostat;
lv_obj_t* screenSound;
lv_obj_t* screenStatus;

// Thermostat/Sound widgets — created ONCE (guarded by these starting
// nullptr) and updated in place on every subsequent redraw, unlike every
// other screen's lv_obj_clean()+recreate-from-scratch pattern. Needed
// specifically because these two now carry a draggable arc: destroying
// and recreating that widget mid-gesture (which a full clean+recreate
// would do, since processEncoder() redraws on every encoder tick and a
// touch-drag redraw would happen from inside the arc's own event
// callback) is a real way to corrupt LVGL's internal drag-tracking state,
// not just a style choice.
lv_obj_t* thermostatArc;
lv_obj_t* thermostatTargetLabel;
lv_obj_t* thermostatCurrentLabel;
lv_obj_t* thermostatHumidityLabel;
lv_obj_t* thermostatCo2Label;
lv_obj_t* thermostatModeBadge;
lv_obj_t* thermostatBadgeDot;

lv_obj_t* soundArc;
lv_obj_t* soundVolLabel;
lv_obj_t* soundSourceLabel;
lv_obj_t* soundEnabledBtn; // the pill-shaped container (background color reflects on/off)
lv_obj_t* soundEnabledLabel; // the text inside it — soundEnabledBtn stopped being a label itself once it became a real button
lv_obj_t* soundBadgeDot;

// ── Local live state — updated from I2C pushes, and by the encoder
// between pushes; the I2C reply always reports these absolute values ──
struct DialState {
  float targetF = 68, currentF = 0, humidity = 0, co2 = 0, outdoorF = 0;
  bool callingHeat = false, callingCool = false, safetyActive = false, weatherStale = true;
  // Most zones only carry an SCD41 (co2 only, no BME680 — see
  // envSensors.js's header on the server) — `humidity` arrives as a
  // meaningless 0.0 sentinel on those, and this flag is the only way to
  // tell that apart from a real 0%. Defaults false (not true) so a
  // bench-tested dial with no real push yet shows "no sensor" rather than
  // flashing a false "0% RH" danger reading before the first real state
  // ever arrives — the safe direction to be wrong in, same reasoning as
  // weatherStale defaulting true.
  bool humidityAvailable = false;
  uint8_t hour = 0, minute = 0;
  uint8_t volumePercent = 0;
  uint8_t activeSource = 0;    // 0=off,1=spotify,2=override1,3=override2 — hardware-detected, read-only here
  bool spotifyEnabled = false; // this dial's own optimistic copy — see onTap()'s SCREEN_SOUND case
  uint8_t faultCount = 0;
  uint8_t maintenanceDueCount = 0;
} state;

bool pendingChange = false;   // set when the encoder has moved something since the last push
uint8_t pendingTapEvent = 0;  // 0=none,1=wake,2=menuSelect,3=toggleSpotifyEnabled,4=returnToMenu,5=markMaintenanceDone

// `state`/pendingChange/pendingTapEvent are written from BOTH the main
// loop() (encoder/touch handling) and the I2C slave callbacks (which the
// ESP32 Arduino core runs outside loop()'s own context) — this spinlock
// is the standard ESP32 idiom for a short critical section between the
// two, guarding just the few lines that actually touch shared state, not
// any LVGL/display work.
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;

// ── Screen state machine ────────────────────────────────────────────────
enum Screen { SCREEN_IDLE, SCREEN_CLOCK, SCREEN_MENU, SCREEN_THERMOSTAT, SCREEN_SOUND, SCREEN_STATUS };
Screen currentScreen = SCREEN_IDLE;
const int MENU_ITEM_CAPACITY = 3; // Sound, Thermostat, Status — array size, NOT how many are currently shown
int menuSelection = 0;         // cycled by rotating on SCREEN_MENU
unsigned long lastInteractionAt = 0;

// Status only ever shows up in the menu while there's something worth
// looking at — under normal conditions the menu is just Sound/Thermostat.
// Every place that used to treat the menu as a fixed 3 items (rotation
// wraparound, index-to-screen mapping, rendering) now calls this instead —
// see processEncoder(), onTap(), menuItemTapEventCb(), showMenuScreen().
bool statusItemVisible() {
  return state.faultCount > 0 || state.maintenanceDueCount > 0;
}
int menuItemCount() {
  return statusItemVisible() ? 3 : 2;
}
// Shared index->screen mapping for both tap paths (menuItemTapEventCb and
// onTap()'s SCREEN_MENU branch) — index 2 (Status) is only ever reachable
// while statusItemVisible() is true, since menuSelection is clamped to
// menuItemCount()-1 everywhere it's set (see showMenuScreen()).
Screen screenForMenuIndex(int index) {
  if (index == 0) return SCREEN_SOUND;
  if (index == 1) return SCREEN_THERMOSTAT;
  return SCREEN_STATUS;
}

// ── I2C slave: RP2040 push in, reply out ────────────────────────────────
// Parses a push straight into `state` — no protocol translation, this is
// the exact same 27B layout that used to arrive over RS485 directly.
void applyPush(const uint8_t* p, uint8_t len) {
  if (len < DIAL_PUSH_LEN) return;
  // memcpy, not a pointer cast — `p` isn't guaranteed 4-byte aligned, and
  // dereferencing an unaligned float* is undefined behavior even though
  // Xtensa usually tolerates it in practice.
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
  state.humidityAvailable = flags & 0x20;
  state.hour   = p[21];
  state.minute = p[22];
  state.volumePercent = p[23];
  state.activeSource = p[24];
  state.faultCount = p[25];
  state.maintenanceDueCount = p[26];
}

// Builds the reply from current state — called right after applyPush()
// inside the same I2C callback, so it's always ready by the time the
// RP2040 follows up with its read (see rs485_node.ino's bridgeDialPoll(),
// which writes then immediately requests).
uint8_t replyBuffer[DIAL_REPLY_LEN];
void buildReply() {
  replyBuffer[0] = (currentScreen == SCREEN_SOUND) ? MODE_SOUND : MODE_THERMOSTAT;
  memcpy(replyBuffer + 1, &state.targetF, 4);
  replyBuffer[5] = pendingChange ? 1 : 0;
  replyBuffer[6] = pendingTapEvent;
  replyBuffer[7] = state.volumePercent;
  pendingChange = false;
  pendingTapEvent = 0;
}

// Runs in the Wire1 slave task's own context, not loop() — keep this
// fast: just copy bytes and update state/build the reply. The actual
// screen redraw is deferred to loop() via needsRedraw, since LVGL work is
// too slow to do safely here.
volatile bool needsRedraw = false;
uint8_t i2cRxBuf[DIAL_PUSH_LEN];

void onI2CReceive(int numBytes) {
  uint8_t len = 0;
  while (Wire1.available() && len < sizeof(i2cRxBuf)) i2cRxBuf[len++] = Wire1.read();
  while (Wire1.available()) Wire1.read(); // drain anything past what we expected

  portENTER_CRITICAL(&stateMux);
  applyPush(i2cRxBuf, len);
  buildReply();
  portEXIT_CRITICAL(&stateMux);

  needsRedraw = true;
}

void onI2CRequest() {
  portENTER_CRITICAL(&stateMux);
  Wire1.write(replyBuffer, DIAL_REPLY_LEN);
  portEXIT_CRITICAL(&stateMux);
}

// ── Rotary encoder ──────────────────────────────────────────────────────
// A genuinely faithful port of Elecrow's own confirmed-working encTaskSafe()
// this time — a dedicated FreeRTOS task polling every 2ms, NOT an
// interrupt. That distinction is the actual fix, not a style choice: an
// ISR fires on every real electrical transition, including every bounce a
// mechanical encoder's contacts produce during a single detent click (real
// bench evidence: delta=-15 from one click). A fixed-rate 2ms poll simply
// can't see bounces faster than its own sample period — it inherently
// low-pass-filters the signal by construction, which no amount of
// after-the-fact software debouncing on an edge-triggered ISR fully
// replicates. Elecrow pins this to core 0 (separate from the main
// loop()'s core 1) — matched here for the same reason: sampling must not
// get starved by whatever else is running on the loop() core.
volatile int encoderDelta = 0;
portMUX_TYPE encoderMux = portMUX_INITIALIZER_UNLOCKED; // cross-CORE safe, unlike noInterrupts()/interrupts() — this task runs on a different core than loop()

void encoderPollTask(void* pvParameters) {
  int previousA = digitalRead(ENCODER_PIN_A);
  while (true) {
    int currentA = digitalRead(ENCODER_PIN_A);
    // Reacts to BOTH edges of A now, not rising-only like Elecrow's
    // original — real bench evidence ("only every other click registers")
    // showed this specific encoder's detents don't all land on A's rising
    // edge alone; some land on the falling edge instead. The direction
    // formula (B relative to A's new level) is the standard quadrature
    // relationship and holds for either edge — it's an XOR-style relation,
    // not something specific to rising transitions.
    if (currentA != previousA) {
      int b = digitalRead(ENCODER_PIN_B);
      portENTER_CRITICAL(&encoderMux);
      // Direction flipped from the first attempt — real bench feedback
      // ("rotation is reversed") confirmed CW/CCW were swapped.
      if (b != currentA) encoderDelta--;
      else encoderDelta++;
      portEXIT_CRITICAL(&encoderMux);
    }
    previousA = currentA;
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

// Consumes accumulated encoder ticks since the last call and applies them
// to whatever the current screen means by "rotate" — menu cycling, target
// adjustment, or volume adjustment. Called from the main loop, not the
// polling task, so it can safely touch LVGL/state (guarded against both
// the task above and the I2C callback with their own spinlocks).
// Unconditional regardless of faultCount/maintenanceDueCount — see this
// file's header on why this dial never gates input on fault/maintenance
// state.
void processEncoder() {
  portENTER_CRITICAL(&encoderMux);
  int delta = encoderDelta;
  encoderDelta = 0;
  portEXIT_CRITICAL(&encoderMux);
  if (delta == 0) return;

  lastInteractionAt = millis();
  portENTER_CRITICAL(&stateMux);
  switch (currentScreen) {
    case SCREEN_CLOCK:
      currentScreen = SCREEN_MENU;
      break;
    case SCREEN_MENU: {
      int count = menuItemCount();
      menuSelection = (menuSelection + (delta > 0 ? 1 : -1) + count) % count;
      break;
    }
    case SCREEN_THERMOSTAT: {
      float next = state.targetF + delta * TARGET_STEP_F;
      state.targetF = constrain(next, TARGET_MIN_F, TARGET_MAX_F);
      pendingChange = true;
      break;
    }
    case SCREEN_SOUND: {
      int next = state.volumePercent + delta * VOLUME_STEP;
      state.volumePercent = constrain(next, 0, 100);
      pendingChange = true;
      break;
    }
    default: break; // STATUS screen is read-only, rotating there does nothing
  }
  portEXIT_CRITICAL(&stateMux);

  switch (currentScreen) {
    case SCREEN_MENU:        showMenuScreen();        break;
    case SCREEN_THERMOSTAT:  showThermostatScreen();  break;
    case SCREEN_SOUND:       showSoundScreen();       break;
    default: break;
  }
}

// ── Global tap/press handling ────────────────────────────────────────────
// Handles the physical knob PRESS everywhere, and touch on screens with no
// competing interactive widget (IDLE/CLOCK — see touchpadReadCb()'s
// gating; STATUS now has its own Mark Done button when maintenance is due,
// see below). Sound/Thermostat carry a real draggable LVGL arc plus their
// own toggle button (thermostatArcEventCb, soundArcEventCb,
// soundEnabledBtnEventCb below), and Menu items are individually tappable
// now (menuItemTapEventCb) — this function deliberately no longer
// special-cases any of their content for TOUCH. The knob press still goes
// through this function unconditionally everywhere, including those
// screens (see checkEncoderButton()) — it's a separate input path from
// touch, not gated the same way. Real user-reported bug this replaced:
// the old design made a bare touch tap ALSO mean "toggle Spotify" on the
// Sound screen, which left no way back once you'd toggled it. The knob
// press is now a uniformly safe "back to menu" gesture on every screen
// that has one, never a toggle. CLOCK also used to only respond to
// rotation (spin to reach the menu) — tap/press now does the exact same
// thing rotation already did, so any input gets you off the clock.
void onTap() {
  lastInteractionAt = millis();
  portENTER_CRITICAL(&stateMux);
  if (currentScreen == SCREEN_IDLE) {
    currentScreen = SCREEN_CLOCK;
    pendingTapEvent = 1; // wake
  } else if (currentScreen == SCREEN_CLOCK) {
    currentScreen = SCREEN_MENU;
  } else if (currentScreen == SCREEN_MENU) {
    pendingTapEvent = 2; // menuSelect
    currentScreen = screenForMenuIndex(menuSelection);
  } else if (currentScreen == SCREEN_SOUND || currentScreen == SCREEN_THERMOSTAT || currentScreen == SCREEN_STATUS) {
    pendingTapEvent = 4; // returnToMenu
    currentScreen = SCREEN_MENU;
  }
  portEXIT_CRITICAL(&stateMux);

  switch (currentScreen) {
    case SCREEN_CLOCK:       showClockScreen();       break;
    case SCREEN_MENU:        showMenuScreen();        break;
    case SCREEN_SOUND:       showSoundScreen();       break;
    case SCREEN_THERMOSTAT:  showThermostatScreen();  break;
    case SCREEN_STATUS:      showStatusScreen();      break;
    default: break;
  }
}

// Menu items are individually tappable now — tapping ANY item jumps
// straight to it, regardless of which one was currently selected by
// rotation. The index tapped is passed as this callback's user_data at
// registration time (see showMenuScreen()). Scrolling to an item and
// pressing the knob still works too (see onTap()'s SCREEN_MENU branch,
// unchanged) — the two are independent, not competing, entry points.
void menuItemTapEventCb(lv_event_t* e) {
  int index = (int)(intptr_t)lv_event_get_user_data(e);
  lastInteractionAt = millis();
  portENTER_CRITICAL(&stateMux);
  menuSelection = index;
  pendingTapEvent = 2; // menuSelect
  currentScreen = screenForMenuIndex(index);
  portEXIT_CRITICAL(&stateMux);

  switch (currentScreen) {
    case SCREEN_SOUND:      showSoundScreen();      break;
    case SCREEN_THERMOSTAT: showThermostatScreen(); break;
    case SCREEN_STATUS:     showStatusScreen();     break;
    default: break;
  }
}

// Fires on an actual touch-drag/click on the arc (confirmed against
// lv_arc.c: lv_arc_set_value(), called below and from processEncoder(),
// does NOT send LV_EVENT_VALUE_CHANGED — only real user interaction does —
// so encoder-driven updates can't feed back into this and double-apply).
void thermostatArcEventCb(lv_event_t* e) {
  lv_obj_t* arc = (lv_obj_t*)lv_event_get_target(e);
  float newTarget = lv_arc_get_value(arc) / 10.0f;
  portENTER_CRITICAL(&stateMux);
  state.targetF = constrain(newTarget, TARGET_MIN_F, TARGET_MAX_F);
  pendingChange = true;
  portEXIT_CRITICAL(&stateMux);
  lastInteractionAt = millis();

  char targetStr[8];
  snprintf(targetStr, sizeof(targetStr), "%.0f\xC2\xB0", state.targetF);
  lv_label_set_text(thermostatTargetLabel, targetStr);
}

void soundArcEventCb(lv_event_t* e) {
  lv_obj_t* arc = (lv_obj_t*)lv_event_get_target(e);
  int newVolume = (int)lv_arc_get_value(arc);
  portENTER_CRITICAL(&stateMux);
  state.volumePercent = constrain(newVolume, 0, 100);
  pendingChange = true;
  portEXIT_CRITICAL(&stateMux);
  lastInteractionAt = millis();

  char volStr[8];
  snprintf(volStr, sizeof(volStr), "%d%%", state.volumePercent);
  lv_label_set_text(soundVolLabel, volStr);
}

// The Spotify enable gate's own dedicated tap target — see this file's
// header on why this is strictly that, never the override inputs. Moved
// off the whole-screen tap gesture (see onTap()'s header comment) onto
// this specific button so there's no more overlap with "how do I leave
// this screen."
void soundEnabledBtnEventCb(lv_event_t* e) {
  lastInteractionAt = millis();
  portENTER_CRITICAL(&stateMux);
  state.spotifyEnabled = !state.spotifyEnabled;
  pendingTapEvent = 3; // toggleSpotifyEnabled
  portEXIT_CRITICAL(&stateMux);

  char enabledStr[16];
  snprintf(enabledStr, sizeof(enabledStr), "Spotify: %s", state.spotifyEnabled ? "On" : "Off");
  lv_label_set_text(soundEnabledLabel, enabledStr);
  lv_obj_set_style_text_color(soundEnabledLabel, state.spotifyEnabled ? lv_color_white() : COLOR_TEXT, 0);
  lv_obj_set_style_bg_color(soundEnabledBtn, state.spotifyEnabled ? COLOR_SPOTIFY : COLOR_TRACK, 0);
}

// Persistent-widget variant of drawStatusBadge() below — that one assumes
// a fresh lv_obj_clean() happened this call (fine for Clock, which still
// fully recreates every redraw); Thermostat/Sound create their widgets
// once, so a badge dot needs to be created once too and just shown/hidden
// in place, or it would silently accumulate a new dot every single redraw.
void updateStatusBadge(lv_obj_t** dotHandle, lv_obj_t* parent) {
  bool show = state.faultCount > 0 || state.maintenanceDueCount > 0;
  if (*dotHandle == nullptr) {
    *dotHandle = lv_obj_create(parent);
    lv_obj_set_size(*dotHandle, 14, 14);
    lv_obj_set_style_radius(*dotHandle, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(*dotHandle, 0, 0);
    lv_obj_clear_flag(*dotHandle, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_align(*dotHandle, LV_ALIGN_TOP_MID, 0, 14);
  }
  lv_obj_set_style_bg_color(*dotHandle, state.faultCount > 0 ? COLOR_DANGER : COLOR_WARNING, 0);
  if (show) lv_obj_clear_flag(*dotHandle, LV_OBJ_FLAG_HIDDEN);
  else lv_obj_add_flag(*dotHandle, LV_OBJ_FLAG_HIDDEN);
}

// Physical knob press, read via the PCF8574 expander (not a direct GPIO —
// see this file's header). Polled, not interrupt-driven: PCF8574 has an
// IRQ pin per-expander, not per-button, and touch already uses the same
// expander's IRQ line for its own purpose — simple edge-detected polling
// here avoids sharing/muxing that interrupt for a control that only needs
// to feel responsive, not real-time.
bool lastEncoderBtnState = true; // PCF8574 INPUT_PULLUP convention: HIGH = released
void checkEncoderButton() {
  uint8_t raw = pcf8574.digitalRead(PCF_ENCODER_BTN, true); // 2nd arg matches Elecrow's own example's call shape for this library version
  bool pressed = raw == LOW;
  static bool lastPressed = false; // debug-only, separate from lastEncoderBtnState below
  if (pressed != lastPressed) {
    Serial.printf("[Dial] encoder button raw=%d pressed=%d\n", raw, pressed);
    lastPressed = pressed;
  }
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
    // Menu item count/labels depend on faultCount/maintenanceDueCount (see
    // menuItemCount()) — redrawn here too so Status appearing/disappearing
    // (e.g. a fault clearing itself while someone's just sitting on the
    // menu) shows up live instead of only on the next navigation.
    case SCREEN_MENU:        showMenuScreen();        break;
    default: break; // IDLE doesn't depend on pushed state
  }
}

// ── LVGL screens ──────────────────────────────────────────────────────
// Widget creation kept simple and re-created per redraw rather than
// diffed/updated in place — at this update rate (once per ~poll reply,
// not every frame) that's simpler and plenty fast, and avoids a class of
// stale-widget-handle bugs while this is still unverified against real
// hardware. Revisit for partial updates once real hardware bring-up shows
// it's needed. (Declarations moved up near lvDisplay/lvIndev — Arduino only
// auto-forward-declares FUNCTIONS, not globals, and onTap()/
// checkEncoderButton() above reference these directly.)

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

  lv_obj_t* card = lv_obj_create(screenClock);
  lv_obj_set_size(card, 340, 340);
  lv_obj_set_style_radius(card, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(card, COLOR_CARD, 0);
  lv_obj_set_style_border_width(card, 0, 0);
  lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_align(card, LV_ALIGN_CENTER, 0, 0);

  char timeStr[6];
  snprintf(timeStr, sizeof(timeStr), "%02d:%02d", state.hour, state.minute);
  lv_obj_t* time = lv_label_create(screenClock);
  lv_label_set_text(time, timeStr);
  lv_obj_set_style_text_color(time, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(time, &lv_font_montserrat_48, 0);
  lv_obj_align(time, LV_ALIGN_CENTER, 0, -30);

  // "Stale/no data" only ever means one thing on a bench-tested dial with
  // no RP2040 companion node wired up yet: it's never received a real
  // POLL_DIAL push, so outdoorF/weatherStale are still at their power-on
  // defaults — not a bug, just nothing to show yet. Worded plainly rather
  // than a bare "-- (stale)", which read as an unexplained error.
  char weatherStr[28];
  if (state.weatherStale) snprintf(weatherStr, sizeof(weatherStr), "Weather: no data yet");
  else snprintf(weatherStr, sizeof(weatherStr), "%.0f\xC2\xB0 outside", state.outdoorF);
  lv_obj_t* weather = lv_label_create(screenClock);
  lv_label_set_text(weather, weatherStr);
  lv_obj_set_style_text_color(weather, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(weather, &lv_font_montserrat_28, 0);
  lv_obj_align(weather, LV_ALIGN_CENTER, 0, 30);

  drawStatusBadge(screenClock);
  lv_scr_load(screenClock);
}

void showMenuScreen() {
  lv_obj_clean(screenMenu);
  lv_obj_set_style_bg_color(screenMenu, COLOR_BG, 0);

  int count = menuItemCount();
  if (menuSelection >= count) menuSelection = count - 1; // Status can vanish out from under an existing selection

  // "Music Volume", not "Sound" — this screen only ever adjusts the
  // Spotify/shared-input's own volume (see soundArcEventCb()/DialState's
  // volumePercent); a TV plugged into this room's override1 input always
  // plays at its own native level, controlled by the TV's own remote, and
  // this dial has no say in that — see zone_audio_node.ino's header. The
  // old "Sound" label implied this screen was a general room-audio
  // control, which it never was.
  const char* labels[MENU_ITEM_CAPACITY] = { "Music Volume", "Thermostat", "Status" };
  const int ySpacing = 70;
  for (int i = 0; i < count; i++) {
    bool selected = (i == menuSelection);
    // Centered as a group regardless of how many items are showing (2 vs
    // 3) — was a fixed (i-1)*ySpacing, which only centered correctly for
    // exactly 3 items.
    int yOffset = (int)((i - (count - 1) / 2.0f) * ySpacing);

    // Pill highlight behind the selected item — color alone (the old
    // design) doesn't read as "selected" nearly as clearly as a filled
    // shape does. Also doubles as the tap target: tapping ANY item's pill
    // (not just the currently-selected one) jumps straight to that
    // screen, via menuItemTapEventCb — a much bigger, more forgiving hit
    // area than the label text alone would be.
    lv_obj_t* pill = lv_obj_create(screenMenu);
    lv_obj_set_size(pill, 260, 56);
    lv_obj_set_style_radius(pill, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(pill, COLOR_ACCENT, 0);
    lv_obj_set_style_bg_opa(pill, selected ? LV_OPA_COVER : LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(pill, 0, 0);
    lv_obj_clear_flag(pill, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_align(pill, LV_ALIGN_CENTER, 0, yOffset);
    lv_obj_add_event_cb(pill, menuItemTapEventCb, LV_EVENT_CLICKED, (void*)(intptr_t)i);

    lv_obj_t* item = lv_label_create(screenMenu);
    lv_label_set_text(item, labels[i]);
    lv_obj_set_style_text_font(item, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(item, selected ? lv_color_white() : COLOR_MUTED, 0);
    lv_obj_align(item, LV_ALIGN_CENTER, 0, yOffset);
    lv_obj_clear_flag(item, LV_OBJ_FLAG_CLICKABLE); // the pill behind it is the real tap target — this just avoids the label swallowing/duplicating the pill's own click
    // "Status" only ever appears in this loop while it's actually got
    // something to show (see menuItemCount()), so the dot next to it is
    // unconditional here — no separate due-check needed anymore.
    if (i == 2) {
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
// position within the safety range, colored by calling state. Draggable —
// see thermostatArcEventCb and this file's header comment on the
// create-once/update-in-place pattern these two screens use.
void showThermostatScreen() {
  bool firstTime = (thermostatArc == nullptr);
  if (firstTime) {
    lv_obj_set_style_bg_color(screenThermostat, COLOR_BG, 0);

    // 400px arc on a 480px round face — fills the screen with just enough
    // margin that the ring itself isn't clipped by the bezel. Was 260px,
    // which read as a small gauge floating in a lot of dead space.
    thermostatArc = lv_arc_create(screenThermostat);
    lv_obj_set_size(thermostatArc, 400, 400);
    lv_arc_set_range(thermostatArc, (int)(TARGET_MIN_F * 10), (int)(TARGET_MAX_F * 10));
    lv_obj_set_style_arc_width(thermostatArc, 26, LV_PART_MAIN);
    lv_obj_set_style_arc_color(thermostatArc, COLOR_TRACK, LV_PART_MAIN);
    lv_obj_set_style_arc_width(thermostatArc, 26, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(thermostatArc, true, LV_PART_INDICATOR);
    lv_obj_align(thermostatArc, LV_ALIGN_CENTER, 0, 0);
    lv_obj_add_event_cb(thermostatArc, thermostatArcEventCb, LV_EVENT_VALUE_CHANGED, NULL);
    // Knob restored (an earlier revision hid it and marked the arc
    // read-only) — dragging it to set the target directly is the point.

    lv_obj_t* backdrop = lv_obj_create(screenThermostat);
    lv_obj_set_size(backdrop, 300, 300);
    lv_obj_set_style_radius(backdrop, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(backdrop, COLOR_CARD, 0);
    lv_obj_set_style_border_width(backdrop, 0, 0);
    lv_obj_clear_flag(backdrop, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(backdrop, LV_OBJ_FLAG_CLICKABLE); // must not steal touches meant for the arc around it
    lv_obj_align(backdrop, LV_ALIGN_CENTER, 0, 0);

    // "HEATING"/"COOLING"/"IDLE" pill — the calling state was previously
    // only visible as the arc's color, which isn't self-explanatory on
    // its own.
    thermostatModeBadge = lv_label_create(screenThermostat);
    lv_obj_set_style_text_font(thermostatModeBadge, &lv_font_montserrat_14, 0);
    lv_obj_set_style_pad_hor(thermostatModeBadge, 14, 0);
    lv_obj_set_style_pad_ver(thermostatModeBadge, 6, 0);
    lv_obj_set_style_radius(thermostatModeBadge, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(thermostatModeBadge, LV_OPA_20, 0);
    lv_obj_align(thermostatModeBadge, LV_ALIGN_CENTER, 0, -75);

    thermostatTargetLabel = lv_label_create(screenThermostat);
    lv_obj_set_style_text_font(thermostatTargetLabel, &lv_font_montserrat_48, 0);
    lv_obj_align(thermostatTargetLabel, LV_ALIGN_CENTER, 0, -15);

    thermostatCurrentLabel = lv_label_create(screenThermostat);
    lv_obj_set_style_text_color(thermostatCurrentLabel, COLOR_MUTED, 0);
    lv_obj_align(thermostatCurrentLabel, LV_ALIGN_CENTER, 0, 40);

    // Humidity/CO2 readouts — same numbers EnvironmentRow.jsx shows on the
    // web app, just plain text here rather than a range bar (screen
    // space). Stacked vertically, not sharing one line — a real CO2
    // reading can hit 4-5 digits, and "45% RH   1842 ppm CO2" on one line
    // was already tight with placeholder numbers, let alone real ones.
    thermostatHumidityLabel = lv_label_create(screenThermostat);
    lv_obj_set_style_text_font(thermostatHumidityLabel, &lv_font_montserrat_14, 0);
    lv_obj_align(thermostatHumidityLabel, LV_ALIGN_BOTTOM_MID, 0, -34);

    thermostatCo2Label = lv_label_create(screenThermostat);
    lv_obj_set_style_text_font(thermostatCo2Label, &lv_font_montserrat_14, 0);
    lv_obj_align(thermostatCo2Label, LV_ALIGN_BOTTOM_MID, 0, -14);

    // No on-screen back button — the knob press is always "back to menu"
    // here (see onTap()), and a dedicated button turned out to be more
    // trouble than it was worth on a round face (see git history: it was
    // getting clipped by the bezel).
  }

  lv_color_t arcColor = state.safetyActive ? COLOR_DANGER
    : state.callingHeat ? COLOR_HEAT
    : state.callingCool ? COLOR_COOL
    : COLOR_ACCENT;
  lv_obj_set_style_arc_color(thermostatArc, arcColor, LV_PART_INDICATOR);
  lv_obj_set_style_bg_color(thermostatArc, arcColor, LV_PART_KNOB); // the draggable handle defaults to the LVGL theme's own accent otherwise — real bench feedback ("volume is orange") turned out to be this, not the indicator fill
  lv_arc_set_value(thermostatArc, (int)(state.targetF * 10));

  const char* modeText = state.safetyActive ? "SAFETY" : state.callingHeat ? "HEATING" : state.callingCool ? "COOLING" : "IDLE";
  lv_label_set_text(thermostatModeBadge, modeText);
  lv_obj_set_style_text_color(thermostatModeBadge, arcColor, 0);
  lv_obj_set_style_bg_color(thermostatModeBadge, arcColor, 0);

  char targetStr[8];
  snprintf(targetStr, sizeof(targetStr), "%.0f\xC2\xB0", state.targetF);
  lv_label_set_text(thermostatTargetLabel, targetStr);
  lv_obj_set_style_text_color(thermostatTargetLabel, COLOR_TEXT, 0);

  char currentStr[24];
  snprintf(currentStr, sizeof(currentStr), "now %.1f\xC2\xB0", state.currentF);
  lv_label_set_text(thermostatCurrentLabel, currentStr);

  // Healthy/borderline/unhealthy thresholds — humidity per common indoor
  // air quality guidance (30-50% ideal, 20-60% acceptable, outside that
  // either too dry or promoting mold/dust mites); CO2 per ASHRAE-style
  // guidance (<800ppm good, 800-1200 acceptable, >1200 poor ventilation).
  lv_color_t co2Color = state.co2 < 800 ? COLOR_SUCCESS
    : state.co2 <= 1200 ? COLOR_WARNING
    : COLOR_DANGER;

  // Most zones only ever carry an SCD41 (co2 only — see this file's header
  // on humidityAvailable/DialState) — showing "0% RH" in danger-red on a
  // zone that will never have a real humidity reading was a real bug, not
  // a cosmetic one; this is the fix.
  char humidityStr[20];
  if (state.humidityAvailable) {
    snprintf(humidityStr, sizeof(humidityStr), "%.0f%% RH", state.humidity);
    lv_label_set_text(thermostatHumidityLabel, humidityStr);
    lv_obj_set_style_text_color(thermostatHumidityLabel,
      (state.humidity >= 30 && state.humidity <= 50) ? COLOR_SUCCESS
      : (state.humidity >= 20 && state.humidity <= 60) ? COLOR_WARNING
      : COLOR_DANGER, 0);
  } else {
    lv_label_set_text(thermostatHumidityLabel, "No RH sensor");
    lv_obj_set_style_text_color(thermostatHumidityLabel, COLOR_MUTED, 0);
  }

  char co2Str[24];
  snprintf(co2Str, sizeof(co2Str), "%.0f ppm CO2", state.co2);
  lv_label_set_text(thermostatCo2Label, co2Str);
  lv_obj_set_style_text_color(thermostatCo2Label, co2Color, 0);

  updateStatusBadge(&thermostatBadgeDot, screenThermostat);
  lv_scr_load(screenThermostat);
}

// Draggable — see soundArcEventCb and this file's header comment on the
// create-once/update-in-place pattern.
void showSoundScreen() {
  bool firstTime = (soundArc == nullptr);
  if (firstTime) {
    lv_obj_set_style_bg_color(screenSound, COLOR_BG, 0);

    // 400px, matching Thermostat — was 260px, a small gauge lost in dead
    // space.
    soundArc = lv_arc_create(screenSound);
    lv_obj_set_size(soundArc, 400, 400);
    lv_arc_set_range(soundArc, 0, 100);
    lv_obj_set_style_arc_width(soundArc, 26, LV_PART_MAIN);
    lv_obj_set_style_arc_color(soundArc, COLOR_TRACK, LV_PART_MAIN);
    lv_obj_set_style_arc_width(soundArc, 26, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(soundArc, true, LV_PART_INDICATOR);
    // Always Spotify green — this screen only ever adjusts Spotify's own
    // volume (see this file's header on why it's labeled "Music Volume,"
    // not a general room control), so it should look like a Spotify
    // control, not borrow the app's generic blue accent. Also not a
    // source indicator (that confused more than it told anyone — see
    // soundSourceLabel below, which carries that information as its own
    // explicit caption instead of being implied by arc color). Knob set
    // explicitly too — it defaults to the LVGL theme's own accent
    // otherwise.
    lv_obj_set_style_arc_color(soundArc, COLOR_SPOTIFY, LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(soundArc, COLOR_SPOTIFY, LV_PART_KNOB);
    lv_obj_align(soundArc, LV_ALIGN_CENTER, 0, 0);
    lv_obj_add_event_cb(soundArc, soundArcEventCb, LV_EVENT_VALUE_CHANGED, NULL);

    lv_obj_t* backdrop = lv_obj_create(screenSound);
    lv_obj_set_size(backdrop, 300, 300);
    lv_obj_set_style_radius(backdrop, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(backdrop, COLOR_CARD, 0);
    lv_obj_set_style_border_width(backdrop, 0, 0);
    lv_obj_clear_flag(backdrop, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(backdrop, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_align(backdrop, LV_ALIGN_CENTER, 0, 0);

    soundVolLabel = lv_label_create(screenSound);
    lv_obj_set_style_text_font(soundVolLabel, &lv_font_montserrat_48, 0);
    lv_obj_align(soundVolLabel, LV_ALIGN_CENTER, 0, -15);

    // activeSource is hardware-detected reality (what's actually audible
    // right now — needs a real zoneAudio node on the bus to ever be
    // anything but "Off"; on a bench-tested dial with no such node
    // attached yet, "Off" is the correct, expected value, not a bug).
    // spotifyEnabled (soundEnabledBtn below) is the separate SETTING this
    // screen's toggle button controls — shown with its own explicit
    // caption specifically because a bare source name with no label read
    // as an unexplained/broken value.
    soundSourceLabel = lv_label_create(screenSound);
    lv_obj_set_style_text_font(soundSourceLabel, &lv_font_montserrat_14, 0);
    lv_obj_align(soundSourceLabel, LV_ALIGN_CENTER, 0, 40);

    // Real pill-shaped button, not bare clickable text — both for a larger
    // actual tap target (padding is part of the hit area, not just the
    // glyph bounds) and so it visually reads as a control.
    // Explicit fixed size — a plain lv_obj_create() does NOT auto-size to
    // its child label by default, so this was previously left at LVGL's
    // default object size regardless of the padding set on it. Combined
    // with LV_RADIUS_CIRCLE that rounded it into an actual circle (radius
    // = min(w,h)/2) that clipped "Spotify: Off" instead of a pill —
    // exactly the reported bug. 260x64 comfortably fits the longer of the
    // two possible strings at font 28 with real margin.
    soundEnabledBtn = lv_obj_create(screenSound);
    lv_obj_set_size(soundEnabledBtn, 260, 64);
    lv_obj_set_style_radius(soundEnabledBtn, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(soundEnabledBtn, 0, 0);
    lv_obj_clear_flag(soundEnabledBtn, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_align(soundEnabledBtn, LV_ALIGN_BOTTOM_MID, 0, -24);
    lv_obj_add_event_cb(soundEnabledBtn, soundEnabledBtnEventCb, LV_EVENT_CLICKED, NULL);
    soundEnabledLabel = lv_label_create(soundEnabledBtn);
    lv_obj_set_style_text_font(soundEnabledLabel, &lv_font_montserrat_28, 0);
    lv_obj_center(soundEnabledLabel);

    // No on-screen back button here either — see the Thermostat screen's
    // comment (same reasoning).
  }

  lv_arc_set_value(soundArc, state.volumePercent);

  char volStr[8];
  snprintf(volStr, sizeof(volStr), "%d%%", state.volumePercent);
  lv_label_set_text(soundVolLabel, volStr);
  lv_obj_set_style_text_color(soundVolLabel, COLOR_TEXT, 0);

  lv_color_t sourceColor = state.activeSource == 1 ? COLOR_SPOTIFY
    : state.activeSource == 2 ? COLOR_ACCENT
    : state.activeSource == 3 ? COLOR_DANGER
    : COLOR_MUTED;
  const char* sourceName = state.activeSource == 1 ? "Spotify"
    : state.activeSource == 2 ? "TV"
    : state.activeSource == 3 ? "Priority Override"
    : "Off";
  char sourceStr[32];
  snprintf(sourceStr, sizeof(sourceStr), "Source: %s", sourceName);
  lv_label_set_text(soundSourceLabel, sourceStr);
  lv_obj_set_style_text_color(soundSourceLabel, sourceColor, 0);

  char enabledStr[16];
  snprintf(enabledStr, sizeof(enabledStr), "Spotify: %s", state.spotifyEnabled ? "On" : "Off");
  lv_label_set_text(soundEnabledLabel, enabledStr);
  lv_obj_set_style_text_color(soundEnabledLabel, state.spotifyEnabled ? lv_color_white() : COLOR_TEXT, 0);
  lv_obj_set_style_bg_color(soundEnabledBtn, state.spotifyEnabled ? COLOR_SPOTIFY : COLOR_TRACK, 0);

  updateStatusBadge(&soundBadgeDot, screenSound);
  lv_scr_load(screenSound);
}

// The Status screen's one real action — faults clear on their own (see
// this file's header/faults.js), but maintenance needs an explicit "I did
// it," and this is that button. Optimistically zeroes the local count so
// the screen (and the menu, once you back out) update instantly instead of
// waiting for the next push; the next real POLL_DIAL push still carries
// the authoritative count, same "optimistic, server confirms" pattern as
// the Spotify toggle (soundEnabledBtnEventCb).
void maintenanceDoneBtnEventCb(lv_event_t* e) {
  lastInteractionAt = millis();
  portENTER_CRITICAL(&stateMux);
  pendingTapEvent = 5; // markMaintenanceDone
  state.maintenanceDueCount = 0;
  portEXIT_CRITICAL(&stateMux);
  showStatusScreen();
}

// Faults are read-only here — counts only, see this file's header on why
// no fault/maintenance text is rendered — they clear on their own once the
// underlying condition resolves. Maintenance gets one real action (the
// Mark Done button above) since "due" doesn't resolve itself. All-clear
// state shown in green so checking this screen is reassuring, not just an
// alert surface.
void showStatusScreen() {
  lv_obj_clean(screenStatus);
  lv_obj_set_style_bg_color(screenStatus, COLOR_BG, 0);

  lv_obj_t* card = lv_obj_create(screenStatus);
  lv_obj_set_size(card, 340, 340);
  lv_obj_set_style_radius(card, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(card, COLOR_CARD, 0);
  lv_obj_set_style_border_width(card, 0, 0);
  lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_align(card, LV_ALIGN_CENTER, 0, 0);

  // No on-screen back button — the knob press is always "back to menu"
  // (see onTap()).

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

    if (state.maintenanceDueCount > 0) {
      // The one real action on this screen — see maintenanceDoneBtnEventCb()
      // above. Touch works directly (touchpadReadCb() treats Status as
      // having its own widget while this button exists); the knob press
      // still means "back to menu" everywhere, unchanged, so there's no
      // ambiguity between the two gestures.
      lv_obj_t* btn = lv_obj_create(screenStatus);
      lv_obj_set_size(btn, 220, 60);
      lv_obj_set_style_radius(btn, LV_RADIUS_CIRCLE, 0);
      lv_obj_set_style_bg_color(btn, COLOR_ACCENT, 0);
      lv_obj_set_style_border_width(btn, 0, 0);
      lv_obj_clear_flag(btn, LV_OBJ_FLAG_SCROLLABLE);
      lv_obj_align(btn, LV_ALIGN_BOTTOM_MID, 0, -36);
      lv_obj_add_event_cb(btn, maintenanceDoneBtnEventCb, LV_EVENT_CLICKED, NULL);

      lv_obj_t* btnLabel = lv_label_create(btn);
      lv_label_set_text(btnLabel, "Mark Done");
      lv_obj_set_style_text_font(btnLabel, &lv_font_montserrat_28, 0);
      lv_obj_set_style_text_color(btnLabel, lv_color_white(), 0);
      lv_obj_center(btnLabel);
    } else {
      lv_obj_t* hint = lv_label_create(screenStatus);
      lv_label_set_text(hint, "See the app for details");
      lv_obj_set_style_text_color(hint, COLOR_MUTED, 0);
      lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -20);
    }
  }

  lv_scr_load(screenStatus);
}

// ── Display/touch driver init ────────────────────────────────────────
// LVGL v9 flush callback signature: px_map is a raw uint8_t* buffer, not
// the v8 lv_color_t* — confirmed against the installed lv_display.h
// (lv_display_flush_cb_t). LV_COLOR_16_SWAP still applies to raw RGB565
// byte order the same way; wrong either way shows up immediately as a
// red/blue channel swap, not a subtle bug.
void displayFlushCb(lv_display_t* disp, const lv_area_t* area, uint8_t* pxMap) {
  uint32_t w = area->x2 - area->x1 + 1;
  uint32_t h = area->y2 - area->y1 + 1;
  static uint32_t flushCount = 0;
  flushCount++;
  if (flushCount <= 20 || flushCount % 50 == 0) {
    Serial.printf("[Dial] displayFlushCb #%lu area=(%d,%d)-(%d,%d) size=%lux%lu\n",
      (unsigned long)flushCount, area->x1, area->y1, area->x2, area->y2, (unsigned long)w, (unsigned long)h);
  }
#if (LV_COLOR_16_SWAP != 0)
  gfx->draw16bitBeRGBBitmap(area->x1, area->y1, (uint16_t*)pxMap, w, h);
#else
  gfx->draw16bitRGBBitmap(area->x1, area->y1, (uint16_t*)pxMap, w, h);
#endif
  lv_display_flush_ready(disp);
}

bool touchPressed = false;
void touchpadReadCb(lv_indev_t* indev, lv_indev_data_t* data) {
  uint8_t n = touch.touched();
  static uint8_t lastN = 0;
  if (n != lastN) {
    Serial.printf("[Dial] touch.touched() = %d\n", n);
    lastN = n;
  }
  if (n) {
    CST_TS_Point p = touch.getPoint(0);
    Serial.printf("[Dial] touch point x=%d y=%d\n", p.x, p.y);
    data->point.x = p.x;
    data->point.y = p.y;
    data->state = LV_INDEV_STATE_PR;
    touchPressed = true;
  } else {
    data->state = LV_INDEV_STATE_REL;
    // Only fires onTap() (this file's own global raw-touch dispatcher) on
    // screens with no competing interactive LVGL widget. Sound/Thermostat
    // have a real draggable arc plus their own toggle button; Menu items
    // are now individually tappable too (menuItemTapEventCb); Status grows
    // its own "Mark Done" button whenever maintenance is actually due —
    // calling onTap() on top of any of these would fire its OWN generic
    // action on every touch release (undoing a drag, jumping to whatever
    // menuSelection happened to be instead of the item actually tapped, or
    // bouncing straight back to the menu before the button's own tap
    // registers). Idle/Clock/an all-clear or fault-only Status have no
    // competing widget, so the plain global tap (wake, tap-to-enter-menu
    // on Clock, tap-anywhere-to-go-back on Status) still applies there.
    bool hasOwnWidgets = currentScreen == SCREEN_SOUND || currentScreen == SCREEN_THERMOSTAT ||
      currentScreen == SCREEN_MENU || (currentScreen == SCREEN_STATUS && state.maintenanceDueCount > 0);
    if (touchPressed && !hasOwnWidgets) onTap();
    touchPressed = false;
  }
}

void LVGL_DISPLAY_INIT() {
  lv_init();
  // Without an explicit tick source, LVGL's internal clock stays frozen at
  // zero forever — confirmed missing by direct comparison against
  // Elecrow's actual working example (lv_tick_set_cb(millis) right after
  // lv_init() there). A frozen tick means every LVGL-internal periodic
  // timer never fires, INCLUDING the touch indev's auto-created read timer
  // (lv_indev_create() creates one internally, but it never actually runs
  // if LVGL never sees time pass) — this alone plausibly explains touch
  // being completely silent while this file's own hand-rolled polling
  // (encoder button, called directly from loop(), untouched by LVGL's
  // clock) worked the whole time.
  lv_tick_set_cb(millis);
  Serial.println("[Dial] lv_init done, tick source set");

  // Wire0 (touch + PCF8574's own internal bus) has to be up BEFORE the
  // PCF8574 is touched at all — pcf8574.begin() talks over I2C itself.
  // This was previously ordered backwards (Wire.begin() lived down in
  // LVGL_TOUCH_INIT(), called AFTER this function's pcf8574.begin()) — a
  // real bug, not just a style choice; moved here to match Elecrow's own
  // working example's setup() order exactly.
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // pcf8574.begin() failing (real evidence, not assumed) means it's not
  // ACKing at PCF8574_ADDR (0x21) — since touch (a DIFFERENT chip on this
  // SAME bus) does ACK, the bus itself works, so this is either the wrong
  // address for this board revision or a hardware fault isolated to the
  // expander. A real scan settles it outright instead of guessing another
  // address.
  Serial.println("[Dial] I2C scan on Wire0:");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) Serial.printf("[Dial]   found device at 0x%02X\n", addr);
  }

  pcf8574.pinMode(PCF_TOUCH_RESET, OUTPUT);
  pcf8574.pinMode(PCF_TOUCH_IRQ, OUTPUT);
  pcf8574.pinMode(PCF_LCD_POWER, OUTPUT);
  pcf8574.pinMode(PCF_LCD_RESET, OUTPUT);
  pcf8574.pinMode(PCF_ENCODER_BTN, INPUT_PULLUP);
  bool pcfOk = pcf8574.begin();
  Serial.printf("[Dial] pcf8574.begin() = %d\n", pcfOk);

  // LCD power + reset sequence — timings matched to Elecrow's own
  // confirmed-working example, not guessed.
  pcf8574.digitalWrite(PCF_LCD_POWER, HIGH);
  delay(100);
  pcf8574.digitalWrite(PCF_LCD_RESET, HIGH);
  delay(100);
  pcf8574.digitalWrite(PCF_LCD_RESET, LOW);
  delay(120);
  pcf8574.digitalWrite(PCF_LCD_RESET, HIGH);
  delay(120);
  Serial.println("[Dial] LCD reset sequence done");

  pinMode(BACKLIGHT_PIN, OUTPUT);
  digitalWrite(BACKLIGHT_PIN, HIGH);
  Serial.println("[Dial] Backlight on, calling gfx->begin()...");

  // gfx->begin()'s return value was previously never checked — if RGB
  // panel init fails (this needs a ~450KB framebuffer, likely from PSRAM;
  // see this file's header on PSRAM being mandatory), the code would
  // silently carry on with a broken/nonexistent display and never say why.
  bool gfxOk = gfx->begin();
  Serial.printf("[Dial] gfx->begin() = %d\n", gfxOk);
  if (!gfxOk) {
    Serial.println("[Dial] FATAL: gfx->begin() failed — check PSRAM (Tools > PSRAM > OPI PSRAM) and the RGB timing/pin values.");
    while (true) delay(1000); // stop here, loudly, rather than proceed with a dead display
  }

  // Real root cause of "everything I set to blue renders as orange" — this
  // exact ST7701 panel needs its MADCTL register's BGR bit set explicitly.
  // Elecrow's own reference does this SEPARATELY from the gfx constructor
  // (their own comment: "so blue... stays blue") — I'd copied their
  // Arduino_RGB_Display/ESP32RGBPanel/SWSPI constructor calls but missed
  // this standalone command, since the REAL installed Arduino_RGB_Display
  // constructor has no BGR parameter to carry it implicitly. Swapping R
  // and B in 0x3B82F6 (this file's blue accent) gives almost exactly
  // 0xF6823B — a strong orange — which is exactly what was reported.
  panelInitBus->beginWrite();
  panelInitBus->writeCommand(0x36); // MADCTL
  panelInitBus->write(0x08);        // BGR bit set
  panelInitBus->endWrite();

  gfx->fillScreen(gfx->color565(0, 0, 0)); // BLACK isn't defined in the installed library (confirmed by grep, not assumed) — color565() is on the base Arduino_GFX class so this can't go stale the same way
  Serial.println("[Dial] fillScreen done");


  static const uint32_t bufPixels = 480 * 40; // partial buffer — full 480x480x2B (450KB) doesn't fit typical LVGL config; PSRAM makes this comfortable
  static const uint32_t bufBytes = bufPixels * 2; // RGB565 = 2 bytes/pixel, matches draw16bitRGBBitmap()
  lvBuf1 = (uint8_t*)heap_caps_malloc(bufBytes, MALLOC_CAP_SPIRAM);
  Serial.printf("[Dial] LVGL buffer alloc = %p (%lu bytes)\n", lvBuf1, (unsigned long)bufBytes);
  if (!lvBuf1) {
    Serial.println("[Dial] FATAL: LVGL buffer allocation failed — PSRAM likely not enabled/available.");
    while (true) delay(1000);
  }

  // LVGL v9 registration API — confirmed against the installed
  // lv_display.h (lv_display_create/set_flush_cb/set_buffers/
  // set_color_format), replacing this file's original v8 lv_disp_drv_t-
  // struct pattern. Color format set explicitly (RGB565) rather than
  // relying on whatever lv_display_create()'s default happens to be —
  // gfx->draw16bitRGBBitmap() below requires it, so this isn't optional.
  lvDisplay = lv_display_create(480, 480);
  lv_display_set_color_format(lvDisplay, LV_COLOR_FORMAT_RGB565);
  lv_display_set_flush_cb(lvDisplay, displayFlushCb);
  lv_display_set_buffers(lvDisplay, lvBuf1, NULL, bufBytes, LV_DISPLAY_RENDER_MODE_PARTIAL);

  // Root-cause fix for "orange showing up everywhere I never asked for
  // it" — lv_display_create() auto-applies LVGL's built-in default theme
  // (confirmed in the installed lv_display.c) with color_secondary =
  // lv_palette_main(LV_PALETTE_RED). Every default-themed part I hadn't
  // explicitly recolored myself (focus/press states, and apparently
  // whatever that stray top-left glyph belongs to) was quietly pulling
  // from that red-toned secondary, which reads as orange on this panel.
  // Re-running the theme init with BOTH primary and secondary set to
  // COLOR_ACCENT (blue) — confirmed via source that passing different
  // colors than the cached theme forces a real rebuild, not a no-op —
  // eliminates every remaining red/orange default in one place instead of
  // chasing individual widget parts.
  lv_theme_t* theme = lv_theme_default_init(lvDisplay, COLOR_ACCENT, COLOR_ACCENT, false, LV_FONT_DEFAULT);
  lv_display_set_theme(lvDisplay, theme);
}

void LVGL_TOUCH_INIT() {
  // Touch reset/IRQ live behind the PCF8574 (see this file's header) — Wire
  // is already up and the expander already begun by LVGL_DISPLAY_INIT()
  // above, which must run first.
  pcf8574.digitalWrite(PCF_TOUCH_RESET, HIGH);
  delay(100);
  pcf8574.digitalWrite(PCF_TOUCH_RESET, LOW);
  delay(120);
  pcf8574.digitalWrite(PCF_TOUCH_RESET, HIGH);
  delay(120);
  pcf8574.digitalWrite(PCF_TOUCH_IRQ, HIGH);
  delay(120);

  bool touchOk = touch.begin(&Wire, TOUCH_I2C_ADDR);
  Serial.printf("[Dial] touch.begin() = %d (addr 0x%02X)\n", touchOk, TOUCH_I2C_ADDR);

  // LVGL v9 registration API — confirmed against the installed
  // lv_indev.h (lv_indev_create/set_type/set_read_cb). set_display() was
  // previously missing — confirmed as a real gap by direct comparison
  // against Elecrow's working example, which calls it explicitly rather
  // than relying on any automatic association with the default display.
  lvIndev = lv_indev_create();
  lv_indev_set_type(lvIndev, LV_INDEV_TYPE_POINTER);
  lv_indev_set_read_cb(lvIndev, touchpadReadCb);
  lv_indev_set_display(lvIndev, lvDisplay);
}

// ── WiFi/HTTP OTA — see this file's header on why this exists instead of
// the RS485-based scheme the RP2040 nodes use ──────────────────────────
// Deliberately BLOCKING and called from loop(), not a separate task — a
// normal check (no update available) is a few seconds of WiFi connect +
// one small HTTP GET, and an actual download+flash over WiFi is realistically
// SECONDS, not the multi-minute affair RS485-at-9600-baud makes it for the
// RP2040 nodes — so a brief, infrequent (every 6h) freeze of touch/encoder/
// display during a check was judged an acceptable, simple tradeoff against
// the real complexity of doing this safely from a second task. WiFi is
// connected only for the duration of a check, then torn back down —
// this board has no other use for it, and there's no reason to leave a
// radio running (power/interference) between checks.
void checkForOTA() {
  Serial.println("[Dial] OTA: connecting to WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(200);
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Dial] OTA: WiFi connect failed/timed out — skipping this check.");
    WiFi.mode(WIFI_OFF);
    return;
  }
  Serial.printf("[Dial] OTA: WiFi connected, IP=%s\n", WiFi.localIP().toString().c_str());

  // No cert pinning (setInsecure()) — a deliberate, flagged tradeoff for a
  // hobbyist home-LAN device checking its own maker's server for a
  // firmware file, not something handling credentials. Still TLS-
  // encrypted in transit, just not certificate-validated.
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String versionUrl = String("https://") + OTA_SERVER_HOST + "/console/dial-firmware/latest";
  if (!http.begin(client, versionUrl)) {
    Serial.println("[Dial] OTA: couldn't start version-check request.");
    WiFi.mode(WIFI_OFF);
    return;
  }
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[Dial] OTA: version check HTTP %d\n", code);
    http.end();
    WiFi.mode(WIFI_OFF);
    return;
  }
  String body = http.getString();
  http.end();

  // Tiny, fixed-shape JSON ({"filename":"...","version":"..."} or null) —
  // hand-parsed rather than pulling in a JSON library for one small,
  // known response shape (see firmwareUpdate.js's getLatestDialFirmware()
  // for what actually produces this).
  int versionIdx = body.indexOf("\"version\":\"");
  int filenameIdx = body.indexOf("\"filename\":\"");
  if (versionIdx == -1 || filenameIdx == -1) {
    Serial.println("[Dial] OTA: no dial firmware uploaded on the server yet — nothing to do.");
    WiFi.mode(WIFI_OFF);
    return;
  }
  int versionStart = versionIdx + 11;
  String serverVersion = body.substring(versionStart, body.indexOf('"', versionStart));
  int filenameStart = filenameIdx + 12;
  String serverFilename = body.substring(filenameStart, body.indexOf('"', filenameStart));

  Serial.printf("[Dial] OTA: running %s, server has %s\n", FIRMWARE_VERSION, serverVersion.c_str());
  if (serverVersion == FIRMWARE_VERSION) {
    Serial.println("[Dial] OTA: already up to date.");
    WiFi.mode(WIFI_OFF);
    return;
  }

  String binUrl = String("https://") + OTA_SERVER_HOST + "/console/firmware/" + serverFilename + "/raw";
  if (!http.begin(client, binUrl)) {
    Serial.println("[Dial] OTA: couldn't start firmware download request.");
    WiFi.mode(WIFI_OFF);
    return;
  }
  code = http.GET();
  if (code != 200) {
    Serial.printf("[Dial] OTA: firmware download HTTP %d\n", code);
    http.end();
    WiFi.mode(WIFI_OFF);
    return;
  }
  int contentLength = http.getSize();
  if (contentLength <= 0) {
    Serial.println("[Dial] OTA: firmware download had no usable Content-Length — aborting.");
    http.end();
    WiFi.mode(WIFI_OFF);
    return;
  }

  // Update.begin()/writeStream()/end() — the same ESP32 Update library
  // the RP2040 side uses its arduino-pico port of; writes into an
  // inactive flash partition, only marked bootable on a clean finish, so
  // an interrupted/corrupt download leaves this board running its OLD
  // firmware, not bricked.
  if (!Update.begin(contentLength)) {
    Serial.printf("[Dial] OTA: Update.begin(%d) failed: %s\n", contentLength, Update.errorString());
    http.end();
    WiFi.mode(WIFI_OFF);
    return;
  }

  // NetworkClient*, not WiFiClient* — confirmed against the installed
  // HTTPClient.h; this core version's networking stack is built around a
  // NetworkClient base class (WiFiClient/WiFiClientSecure are typedefs/
  // subclasses of it now, not the other way around).
  NetworkClient* stream = http.getStreamPtr();
  size_t written = Update.writeStream(*stream);
  http.end();

  if (written != (size_t)contentLength) {
    Serial.printf("[Dial] OTA: wrote %u of %d bytes — aborting, staying on current firmware.\n", (unsigned)written, contentLength);
    Update.abort();
    WiFi.mode(WIFI_OFF);
    return;
  }

  if (!Update.end(true)) {
    Serial.printf("[Dial] OTA: Update.end() failed: %s — staying on current firmware.\n", Update.errorString());
    WiFi.mode(WIFI_OFF);
    return;
  }

  Serial.println("[Dial] OTA: update applied successfully, rebooting into new firmware.");
  delay(200); // let the Serial line actually flush before the reboot cuts it
  ESP.restart();
}

// ── Setup ────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("[Dial] Serial up, starting setup()"); // if this never shows: USB CDC On Boot is off, or a crash happened before Serial.begin()

  // Plain INPUT (not INPUT_PULLUP) — matches Elecrow's own working setup
  // exactly; the board apparently already has whatever pull resistors this
  // encoder needs. Polling task (not an interrupt) started here, pinned to
  // core 0 same as Elecrow's own — see encoderPollTask()'s comment.
  pinMode(ENCODER_PIN_A, INPUT);
  pinMode(ENCODER_PIN_B, INPUT);
  xTaskCreatePinnedToCore(encoderPollTask, "ENC", 2048, NULL, 1, NULL, 0);

  LVGL_DISPLAY_INIT();
  Serial.println("[Dial] LVGL_DISPLAY_INIT done");
  LVGL_TOUCH_INIT(); // after LVGL_DISPLAY_INIT() — shares the PCF8574 it initializes
  Serial.println("[Dial] LVGL_TOUCH_INIT done");

  screenIdle       = lv_obj_create(NULL);
  screenClock      = lv_obj_create(NULL);
  screenMenu       = lv_obj_create(NULL);
  screenThermostat = lv_obj_create(NULL);
  screenSound      = lv_obj_create(NULL);
  screenStatus     = lv_obj_create(NULL);
  showIdleScreen();
  Serial.println("[Dial] screens created, idle shown");

  buildReply(); // seeds replyBuffer before the RP2040's first request ever arrives

  // Wire1, slave mode — the link to the paired RP2040 node. Deliberately
  // separate from Wire0 above (touch/PCF8574) rather than sharing one bus
  // in two roles.
  Wire1.begin(DIAL_I2C_ADDR, DIAL_I2C_SDA_PIN, DIAL_I2C_SCL_PIN);
  Wire1.onReceive(onI2CReceive);
  Wire1.onRequest(onI2CRequest);

  lastInteractionAt = millis();
  Serial.println("[Dial] Boot complete.");
}

// ── Main loop ────────────────────────────────────────────────────────
// Starts at (millis() - OTA_CHECK_INTERVAL_MS + OTA_FIRST_CHECK_DELAY_MS)
// rather than 0 so the FIRST check fires ~30s after boot instead of
// immediately — gives the dial a chance to be confirmed interactive
// before its very first (worst-case up-to-8s) WiFi connect attempt runs,
// see checkForOTA()'s comment on why this blocks.
unsigned long lastOtaCheckAt = 0 - OTA_CHECK_INTERVAL_MS + OTA_FIRST_CHECK_DELAY_MS;

void loop() {
  lv_timer_handler();
  processEncoder();
  checkEncoderButton();
  checkIdleTimeout();

  if (needsRedraw) {
    needsRedraw = false;
    refreshActiveScreen();
  }

  if (millis() - lastOtaCheckAt >= OTA_CHECK_INTERVAL_MS) {
    lastOtaCheckAt = millis();
    checkForOTA();
  }
}
