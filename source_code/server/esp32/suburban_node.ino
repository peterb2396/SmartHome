/**
 * Suburban Vehicle Node  v2
 * ─────────────────────────────────────────────────────────────────
 * SIM7600 cellular modem  +  ESP32
 *
 * Changes from v1:
 *   • Long-polling on GET /device/next?wait=1
 *     — server holds the connection open 25s and responds the instant
 *       a command is queued. Eliminates the race condition where a
 *       short-poll interval (10s) + execution time exceeded the old
 *       35s server timeout.
 *   • CAR_ON_PIN (GPIO 35, input-only, 3.3 V tolerant)
 *     — wire to your ignition-sense signal (3.3 V = engine on).
 *     — state is sent as ?carOn=0|1 on every poll request and in
 *       every result POST so the smarthome dashboard always knows
 *       whether the engine is running.
 *
 * ── Wiring additions ──────────────────────────────────────────────
 *   Ignition sense wire  → 3.3 V divider → GPIO 35
 *   (GPIO 35 is input-only on ESP32, safe for sensing)
 *   If your signal is 12 V: use a resistor divider:
 *     12V ──[33kΩ]──┬── GPIO35
 *                  [10kΩ]
 *                   │
 *                  GND
 *   That gives 12 * 10/(33+10) ≈ 2.8 V, safely under 3.3 V.
 */

#include <HardwareSerial.h>

// ==================== CONFIGURATION ====================
const char* SERVER_URL = "smarthome153.onrender.com";
const char* AUTH_TOKEN = "67a384ed4660627e9c127b1c";
const char* DEVICE_ID  = "SUBURBAN";
const char* APN        = "simbase";

// Hardware pins
#define SIM_RX          16
#define SIM_TX          17
#define SIM_PWR          4
#define LED_PIN          2
#define LOCK_PIN        26
#define UNLOCK_PIN      27
#define REMOTE_START_PIN 25
#define CAR_ON_PIN      35   // INPUT — wire ignition sense here (3.3 V = on)

// ==================== GLOBALS ====================
HardwareSerial modem(2);
bool ready    = false;
int  carOnVal = 0;   // latest reading of CAR_ON_PIN

// ==================== HELPERS ====================
void flush() {
  delay(100);
  while (modem.available()) modem.read();
}

bool at(const String& cmd, const String& expect, int timeout = 2000) {
  flush();
  modem.println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeout) {
    while (modem.available()) resp += (char)modem.read();
    if (resp.indexOf(expect) != -1) return true;
    if (resp.indexOf("ERROR") != -1) return false;
    delay(10);
  }
  return false;
}

void press(int pin, int ms) {
  digitalWrite(pin, HIGH);
  delay(ms);
  digitalWrite(pin, LOW);
}

// Read ignition pin and cache result
void readCarOn() {
  carOnVal = digitalRead(CAR_ON_PIN);
}

// ==================== MODEM SETUP ====================
void powerModem() {
  Serial.println("⚡ Powering modem...");
  digitalWrite(SIM_PWR, LOW);  delay(100);
  digitalWrite(SIM_PWR, HIGH); delay(1000);
  digitalWrite(SIM_PWR, LOW);  delay(3000);
  digitalWrite(SIM_PWR, HIGH); delay(3000);
  flush();
}

bool initModem() {
  Serial.println("📡 Connecting...");
  if (!at("AT", "OK")) return false;
  at("ATE0", "OK", 1000);

  if (!at("AT+CPIN?", "READY", 5000)) {
    Serial.println("❌ No SIM card"); return false;
  }

  at("AT+CGDCONT=1,\"IP\",\"" + String(APN) + "\"", "OK", 5000);
  at("AT+CGATT=1",  "OK", 10000);
  at("AT+CGACT=1,1","OK", 15000);

  Serial.print("📶 Searching");
  for (int i = 0; i < 30; i++) {
    String r; flush();
    modem.println("AT+CREG?");
    delay(1000);
    while (modem.available()) r += (char)modem.read();
    if (r.indexOf("+CREG: 0,1") != -1 || r.indexOf("+CREG: 0,5") != -1) {
      Serial.println(" ✓");
      at("AT+CTZU=1",              "OK", 2000);
      at("AT+CLTS=1",              "OK", 2000);
      at("AT+CNTP=\"pool.ntp.org\",0","OK", 2000);
      at("AT+CNTP",                "OK", 10000);
      return true;
    }
    Serial.print("."); delay(1000);
  }
  Serial.println(" ❌");
  return false;
}

// ==================== HTTP ====================
bool httpRequest(const String& method, const String& path,
                 const String& body, int& status, String& response) {
  status = 0; response = "";

  at("AT+HTTPTERM", "OK", 2000);
  delay(500);

  at("AT+CSSLCFG=\"sslversion\",0,3",    "OK", 3000);
  at("AT+CSSLCFG=\"authmode\",0,0",      "OK", 3000);
  at("AT+CSSLCFG=\"enableSNI\",0,1",     "OK", 3000);
  at("AT+CSSLCFG=\"ignorertctime\",0,1", "OK", 3000);

  if (!at("AT+HTTPINIT", "OK", 5000)) return false;
  at("AT+HTTPPARA=\"SSLCFG\",0", "OK", 3000);

  String url = "https://" + String(SERVER_URL) + path;
  if (!at("AT+HTTPPARA=\"URL\",\"" + url + "\"", "OK", 5000)) {
    at("AT+HTTPTERM", "OK", 2000); return false;
  }

  at("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 3000);
  at("AT+HTTPPARA=\"USERDATA\",\"Authorization: Bearer " + String(AUTH_TOKEN) + "\"", "OK", 5000);

  if (method == "POST" && body.length() > 0) {
    if (!at("AT+HTTPDATA=" + String(body.length()) + ",10000", "DOWNLOAD", 5000)) {
      at("AT+HTTPTERM", "OK", 2000); return false;
    }
    modem.print(body);
    delay(500);
  }

  // Long-poll GET needs a longer AT timeout — server holds for up to 25s
  // We give it 30s here so we never time out on the modem side first.
  int actionTimeout = (method == "GET") ? 30000 : 5000;
  String action = (method == "POST") ? "AT+HTTPACTION=1" : "AT+HTTPACTION=0";
  if (!at(action, "OK", actionTimeout)) {
    at("AT+HTTPTERM", "OK", 2000); return false;
  }

  unsigned long start = millis();
  String urc = "";
  // Wait up to 32s for the +HTTPACTION URC (long-poll can take 25s + overhead)
  while (millis() - start < 32000) {
    while (modem.available()) urc += (char)modem.read();
    if (urc.indexOf("+HTTPACTION:") != -1) {
      int c1 = urc.indexOf(',');
      int c2 = urc.indexOf(',', c1 + 1);
      if (c1 != -1 && c2 != -1) {
        status = urc.substring(c1 + 1, c2).toInt();
        int len = urc.substring(c2 + 1).toInt();
        if (len > 0) {
          flush();
          modem.println("AT+HTTPREAD=0," + String(len));
          delay(500);
          while (modem.available()) response += (char)modem.read();
          int s = response.indexOf('{');
          int e = response.lastIndexOf('}');
          if (s != -1 && e != -1) response = response.substring(s, e + 1);
        }
        at("AT+HTTPTERM", "OK", 2000);
        return true;
      }
    }
    delay(100);
  }

  at("AT+HTTPTERM", "OK", 2000);
  return false;
}

// ==================== CAR CONTROL ====================
void startCar() {
  Serial.println("\n🚗 STARTING SUBURBAN");
  Serial.println("  🔒 Lock"); press(LOCK_PIN, 300);   delay(1000);
  Serial.println("  🔒 Lock"); press(LOCK_PIN, 300);   delay(1000);
  Serial.println("  🔑 Start (3.5s)"); press(REMOTE_START_PIN, 3500); delay(2000);
  Serial.println("✅ Done!\n");
}

bool netOpen() {
  at("AT+NETCLOSE", "OK", 5000); delay(300);
  return at("AT+NETOPEN", "OK", 10000);
}

void recoverFromHandshakeFail() {
  Serial.println("\n🧯 Recovering from 715 handshake fail...");
  at("AT+HTTPTERM", "OK", 3000); delay(300);
  at("AT+NETCLOSE", "OK", 5000); delay(500);
  netOpen(); delay(500);
  at("AT+CGATT=1",  "OK", 10000);
  at("AT+CGACT=1,1","OK", 15000);
  Serial.println("✅ Recovery done.\n");
}

// ==================== MAIN LOOP ====================
/**
 * Long-poll loop:
 *   1. Read ignition pin
 *   2. GET /device/next?deviceId=SUBURBAN&wait=1&carOn=0|1
 *      — server holds connection open up to 25s
 *      — responds immediately if a command is queued
 *   3. If a command came back, execute it and POST /device/result
 *   4. Repeat immediately (no delay between polls)
 */
void checkForCommands() {
  readCarOn();

  String path = "/device/next?deviceId=" + String(DEVICE_ID)
              + "&wait=1"
              + "&carOn=" + String(carOnVal);

  int    status;
  String body;

  Serial.print(carOnVal ? "🔥" : "💤");  // heartbeat: engine on/off

  if (!httpRequest("GET", path, "", status, body)) {
    Serial.println(" ⚠️  Connection failed, retrying in 5s");
    delay(5000);
    return;
  }

  if (status == 715) {
    Serial.println(" ⚠️  TLS 715");
    recoverFromHandshakeFail();
    return;
  }

  if (status != 200) {
    Serial.println(" ⚠️  HTTP " + String(status));
    delay(3000);
    return;
  }

  // No command — server timed out long-poll, reopen immediately
  if (body.length() == 0 || body.indexOf("\"cmd\"") == -1 ||
      body.indexOf("\"cmd\":null") != -1) {
    return;
  }

  // Extract cmdId
  int p = body.indexOf("\"cmdId\":\"");
  if (p == -1) return;
  int cmdIdStart = p + 9;
  int cmdIdEnd   = body.indexOf("\"", cmdIdStart);
  if (cmdIdEnd == -1) return;
  String cmdId = body.substring(cmdIdStart, cmdIdEnd);

  // Execute command
  bool   ok      = false;
  String message = "Unknown command";

  digitalWrite(LED_PIN, LOW);

  if (body.indexOf("\"cmd\":\"start\"") != -1) {
    Serial.println("\n🎯 START");
    startCar();
    ok = true; message = "Started";
  } else if (body.indexOf("\"cmd\":\"lock\"") != -1) {
    Serial.println("\n🔒 LOCK");
    press(LOCK_PIN, 300);
    ok = true; message = "Locked";
  } else if (body.indexOf("\"cmd\":\"unlock\"") != -1) {
    Serial.println("\n🔓 UNLOCK");
    press(UNLOCK_PIN, 300);
    ok = true; message = "Unlocked";
  } else {
    Serial.println("\n⚠️  Unknown cmd: " + body);
  }

  digitalWrite(LED_PIN, HIGH);

  // Re-read ignition pin after execution (engine may now be running)
  readCarOn();

  // POST result — include updated carOn state
  String result = "{\"deviceId\":\"" + String(DEVICE_ID) +
                  "\",\"cmdId\":\""  + cmdId   +
                  "\",\"ok\":"       + (ok ? "true" : "false") +
                  ",\"message\":\""  + message +
                  "\",\"carOn\":"    + (carOnVal ? "true" : "false") +
                  "}";

  int    postStatus;
  String postResp;
  if (!httpRequest("POST", "/device/result", result, postStatus, postResp)) {
    Serial.println("⚠️  Failed to POST result");
    return;
  }
  Serial.println("📤 Result → HTTP " + String(postStatus));
}

// ==================== ARDUINO ====================
void setup() {
  Serial.begin(115200);
  modem.begin(115200, SERIAL_8N1, SIM_RX, SIM_TX);

  pinMode(LOCK_PIN,         OUTPUT); digitalWrite(LOCK_PIN,         LOW);
  pinMode(UNLOCK_PIN,       OUTPUT); digitalWrite(UNLOCK_PIN,       LOW);
  pinMode(REMOTE_START_PIN, OUTPUT); digitalWrite(REMOTE_START_PIN, LOW);
  pinMode(LED_PIN,          OUTPUT); digitalWrite(LED_PIN,          LOW);
  pinMode(SIM_PWR,          OUTPUT);
  pinMode(CAR_ON_PIN,       INPUT);  // no pull-up — driven by external signal

  Serial.println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Serial.println("  SUBURBAN REMOTE STARTER v2");
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  powerModem();

  if (initModem()) {
    ready = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println("✅ Ready!\n");
  } else {
    Serial.println("❌ Failed to connect\n");
  }
}

void loop() {
  if (!ready) {
    Serial.println("🔄 Retrying init...");
    if (initModem()) {
      ready = true;
      digitalWrite(LED_PIN, HIGH);
      Serial.println("✅ Ready!\n");
    }
    delay(10000);
    return;
  }

  // No delay between iterations — long-poll itself provides the pacing
  checkForCommands();
}
