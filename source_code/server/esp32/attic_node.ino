/**
 * ESP32 Attic Sensor Node
 * ─────────────────────────────────────────────────────────────────
 * Reads sensors and POSTs a batch report to the home server every
 * REPORT_INTERVAL_MS milliseconds via POST /esp32/report.
 *
 * Add sensors by wiring them up and adding to buildSensors().
 *
 * ── Libraries (install via Arduino Library Manager) ──────────────
 *   WiFi              built-in ESP32
 *   HTTPClient        built-in ESP32
 *   ArduinoJson       by Benoit Blanchon  (v6.x)
 *   DHT sensor library  by Adafruit
 *   Adafruit Unified Sensor  by Adafruit
 *
 * ── Wiring ───────────────────────────────────────────────────────
 *   DHT22 data        → GPIO 4
 *   Window reed SW 1  → GPIO 14  (other leg to GND)
 *   Window reed SW 2  → GPIO 12  (other leg to GND)
 *   Garage reed SW    → GPIO 27  (other leg to GND, if wired here
 *                                 instead of directly to the Pi)
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
const unsigned long REPORT_INTERVAL_MS = 30000;          // report every 30s

// ── Pin definitions ───────────────────────────────────────────────
#define DHT_PIN        4
#define DHT_TYPE       DHT22

// Reed switches — add as many as you have.
// Each entry: { gpio pin, sensor name sent to server }
struct ReedSwitch { int pin; const char* name; const char* location; };

const ReedSwitch REED_SWITCHES[] = {
  { 14, "window-north",  "North attic window"  },
  { 12, "window-east",   "East attic window"   },
  // { 27, "garage",     "Garage door"          },  // only if NOT wired to Pi
};
const int NUM_REED = sizeof(REED_SWITCHES) / sizeof(REED_SWITCHES[0]);

// ── Globals ───────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastReport = 0;

// ── Setup ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);

  dht.begin();

  for (int i = 0; i < NUM_REED; i++) {
    pinMode(REED_SWITCHES[i].pin, INPUT_PULLUP);
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

// ── Build and POST the sensor report ─────────────────────────────
void sendReport() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[ESP32] WiFi disconnected, skipping report.");
    WiFi.reconnect();
    return;
  }

  // Read DHT22
  float tempF = dht.readTemperature(true);
  float tempC = dht.readTemperature(false);
  float humid = dht.readHumidity();
  bool  dhtOk = !isnan(tempF) && !isnan(humid);

  // Build JSON
  // {
  //   "auth": "TOKEN",
  //   "sensors": {
  //     "temp-attic":     { "value": 72.1, "unit": "F", "metadata": { "location": "attic" } },
  //     "humidity-attic": { "value": 55,   "unit": "%" },
  //     "window-north":   { "value": "open" },
  //     ...
  //   }
  // }
  StaticJsonDocument<1024> doc;
  doc["auth"] = AUTH_TOKEN;

  JsonObject sensorsObj = doc.createNestedObject("sensors");

  // Temperature
  if (dhtOk) {
    JsonObject temp     = sensorsObj.createNestedObject("temp-attic");
    temp["value"]       = round(tempF * 10.0) / 10.0;
    temp["unit"]        = "F";
    JsonObject tempMeta = temp.createNestedObject("metadata");
    tempMeta["location"] = "attic";
    tempMeta["celsius"]  = round(tempC * 10.0) / 10.0;

    JsonObject hum      = sensorsObj.createNestedObject("humidity-attic");
    hum["value"]        = round(humid * 10.0) / 10.0;
    hum["unit"]         = "%";
    JsonObject humMeta  = hum.createNestedObject("metadata");
    humMeta["location"] = "attic";
  } else {
    Serial.println("[ESP32] DHT22 read failed.");
  }

  // Reed switches
  for (int i = 0; i < NUM_REED; i++) {
    bool isOpen = digitalRead(REED_SWITCHES[i].pin) == HIGH;

    JsonObject sw      = sensorsObj.createNestedObject(REED_SWITCHES[i].name);
    sw["value"]        = isOpen ? "open" : "closed";
    JsonObject swMeta  = sw.createNestedObject("metadata");
    swMeta["location"] = REED_SWITCHES[i].location;
    swMeta["source"]   = "esp32";
  }

  // Serialize and send
  String body;
  serializeJson(doc, body);

  Serial.printf("[ESP32] Reporting — temp: %.1f°F  hum: %.0f%%\n",
    dhtOk ? tempF : 0.0, dhtOk ? humid : 0.0);
  for (int i = 0; i < NUM_REED; i++) {
    Serial.printf("  %s: %s\n",
      REED_SWITCHES[i].name,
      digitalRead(REED_SWITCHES[i].pin) == HIGH ? "OPEN" : "closed");
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + AUTH_TOKEN);

  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("[ESP32] Server: HTTP %d\n", code);
  } else {
    Serial.printf("[ESP32] HTTP error: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}
