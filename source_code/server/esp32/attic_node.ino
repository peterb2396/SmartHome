/**
 * ESP32 Attic Node
 * ─────────────────────────────────────────────────────────────────
 * Pure I/O transport for anything wired upstairs (too far to run
 * direct GPIO back to the basement Pi). ALL decision logic — what
 * temperature a zone should be, whether a relay should be on — lives
 * on the main server. This node just:
 *   1. Reads sensors and POSTs a batch report to /esp32/report
 *   2. Reads the `relays` object in the server's JSON response and
 *      applies those ON/OFF states to its output pins
 *
 * No inbound connection to this node is required — everything flows
 * through the existing report/response cycle, every REPORT_INTERVAL_MS.
 *
 * Add sensors/relays by wiring them up and adding a row to
 * TEMP_SENSORS / REED_SWITCHES / RELAY_OUTPUTS below.
 *
 * ── Libraries (install via Arduino Library Manager) ──────────────
 *   WiFi              built-in ESP32
 *   HTTPClient        built-in ESP32
 *   ArduinoJson       by Benoit Blanchon  (v6.x)
 *   DHT sensor library  by Adafruit
 *   Adafruit Unified Sensor  by Adafruit
 *
 * ── Wiring ───────────────────────────────────────────────────────
 *   DHT22 #1 data (Primary Suite) → GPIO 4
 *   DHT22 #2 data (Upstairs)      → GPIO 16
 *   Window reed SW 1              → GPIO 14  (other leg to GND)
 *   Window reed SW 2              → GPIO 12  (other leg to GND)
 *   Zone relay — Primary Suite    → GPIO 25  (damper/zone-valve call-for-heat)
 *   Zone relay — Upstairs         → GPIO 33
 *
 * Reed switch: closed (magnet present) = LOW = "closed"
 *              open   (no magnet)      = HIGH = "open"
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// ── Config — edit these ───────────────────────────────────────────
const char* WIFI_SSID          = "YOUR_WIFI_SSID";
const char* WIFI_PASS          = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL         = "http://192.168.1.100:3001/esp32/report";  // local IP of Pi
const char* AUTH_TOKEN         = "YOUR_SENSOR_TOKEN";    // matches SENSOR_TOKEN in .env
const unsigned long REPORT_INTERVAL_MS = 15000;          // report every 15s

// ── Temperature/humidity sensors — one zone's DHT22 per entry ────
struct TempSensor { int pin; const char* tempName; const char* humidityName; const char* location; };

DHT dhtPrimarySuite(4, DHT22);
DHT dhtUpstairs(16, DHT22);

// ── Reed switches — add as many as you have ───────────────────────
struct ReedSwitch { int pin; const char* name; const char* location; };

const ReedSwitch REED_SWITCHES[] = {
  { 14, "window-primary-suite", "Primary Suite window" },
  { 12, "window-upstairs",      "Upstairs window"       },
};
const int NUM_REED = sizeof(REED_SWITCHES) / sizeof(REED_SWITCHES[0]);

// ── Relay outputs — names MUST match `relayName` in thermostat.js's
//    ZONES config for any zone with node: 'attic' ────────────────
struct RelayOutput { int pin; const char* name; };

const RelayOutput RELAY_OUTPUTS[] = {
  { 25, "zone-primary-suite" },
  { 33, "zone-upstairs"      },
};
const int NUM_RELAYS = sizeof(RELAY_OUTPUTS) / sizeof(RELAY_OUTPUTS[0]);

// ── Globals ───────────────────────────────────────────────────────
unsigned long lastReport = 0;

// ── Setup ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);

  dhtPrimarySuite.begin();
  dhtUpstairs.begin();

  for (int i = 0; i < NUM_REED; i++) {
    pinMode(REED_SWITCHES[i].pin, INPUT_PULLUP);
  }
  for (int i = 0; i < NUM_RELAYS; i++) {
    pinMode(RELAY_OUTPUTS[i].pin, OUTPUT);
    digitalWrite(RELAY_OUTPUTS[i].pin, LOW);
  }

  Serial.println("[ESP32] Connecting to WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[ESP32] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
}

// ── Main loop ─────────────────────────────────────────────────────
void loop() {
  if (millis() - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = millis();
    sendReport();
  }
}

// ── Apply relay commands received from the server ────────────────
void applyRelayCommands(JsonObject relays) {
  for (int i = 0; i < NUM_RELAYS; i++) {
    if (relays.containsKey(RELAY_OUTPUTS[i].name)) {
      bool on = relays[RELAY_OUTPUTS[i].name];
      digitalWrite(RELAY_OUTPUTS[i].pin, on ? HIGH : LOW);
      Serial.printf("  relay %s -> %s\n", RELAY_OUTPUTS[i].name, on ? "ON" : "off");
    }
  }
}

// ── Build and POST the sensor report, apply the relay response ───
void sendReport() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[ESP32] WiFi disconnected, skipping report.");
    WiFi.reconnect();
    return;
  }

  StaticJsonDocument<1536> doc;
  doc["auth"] = AUTH_TOKEN;
  JsonObject sensorsObj = doc.createNestedObject("sensors");

  // Primary Suite DHT22
  float tPS = dhtPrimarySuite.readTemperature(true);
  float hPS = dhtPrimarySuite.readHumidity();
  if (!isnan(tPS) && !isnan(hPS)) {
    JsonObject temp = sensorsObj.createNestedObject("temp-primary-suite");
    temp["value"] = round(tPS * 10.0) / 10.0;
    temp["unit"] = "F";
    temp.createNestedObject("metadata")["location"] = "Primary Suite";

    JsonObject hum = sensorsObj.createNestedObject("humidity-primary-suite");
    hum["value"] = round(hPS * 10.0) / 10.0;
    hum["unit"] = "%";
  } else {
    Serial.println("[ESP32] Primary Suite DHT22 read failed.");
  }

  // Upstairs DHT22
  float tUp = dhtUpstairs.readTemperature(true);
  float hUp = dhtUpstairs.readHumidity();
  if (!isnan(tUp) && !isnan(hUp)) {
    JsonObject temp = sensorsObj.createNestedObject("temp-upstairs");
    temp["value"] = round(tUp * 10.0) / 10.0;
    temp["unit"] = "F";
    temp.createNestedObject("metadata")["location"] = "Upstairs";

    JsonObject hum = sensorsObj.createNestedObject("humidity-upstairs");
    hum["value"] = round(hUp * 10.0) / 10.0;
    hum["unit"] = "%";
  } else {
    Serial.println("[ESP32] Upstairs DHT22 read failed.");
  }

  // Reed switches
  for (int i = 0; i < NUM_REED; i++) {
    bool isOpen = digitalRead(REED_SWITCHES[i].pin) == HIGH;
    JsonObject sw = sensorsObj.createNestedObject(REED_SWITCHES[i].name);
    sw["value"] = isOpen ? "open" : "closed";
    JsonObject swMeta = sw.createNestedObject("metadata");
    swMeta["location"] = REED_SWITCHES[i].location;
    swMeta["source"] = "esp32";
  }

  String body;
  serializeJson(doc, body);

  Serial.printf("[ESP32] Reporting — Primary Suite: %.1f°F  Upstairs: %.1f°F\n", tPS, tUp);

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + AUTH_TOKEN);

  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("[ESP32] Server: HTTP %d\n", code);
    String respBody = http.getString();

    StaticJsonDocument<512> respDoc;
    DeserializationError err = deserializeJson(respDoc, respBody);
    if (!err && respDoc.containsKey("relays")) {
      applyRelayCommands(respDoc["relays"].as<JsonObject>());
    } else if (err) {
      Serial.printf("[ESP32] Response parse error: %s\n", err.c_str());
    }
  } else {
    Serial.printf("[ESP32] HTTP error: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}
