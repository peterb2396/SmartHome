/**
 * ESP32 Attic Sensor Node
 * ─────────────────────────────────────────────────────────────────
 * Reads temperature, humidity, and any connected window/door sensors,
 * then POSTs a batch report to the home server every REPORT_INTERVAL_MS.
 *
 * Wiring (adjust pins to your setup):
 *   DHT22 data     → GPIO 4
 *   Window sensor  → GPIO 14 (magnetic reed switch, other leg to GND)
 *   Garage sensor  → GPIO 27 (magnetic reed switch, other leg to GND)
 *
 * Libraries required (install via Arduino Library Manager):
 *   - WiFi             (built-in ESP32)
 *   - HTTPClient       (built-in ESP32)
 *   - ArduinoJson      (by Benoit Blanchon)
 *   - DHT sensor library (by Adafruit)
 *   - Adafruit Unified Sensor
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// ── Config ────────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";

// Your home server URL (local IP or dynamic DNS)
const char* SERVER_URL    = "http://192.168.1.100:3001/esp32/report";

// Must match SENSOR_TOKEN or ADMIN_UID in your server .env
const char* AUTH_TOKEN    = "YOUR_SENSOR_TOKEN";

const unsigned long REPORT_INTERVAL_MS = 30000; // Report every 30 seconds

// ── Pin definitions ───────────────────────────────────────────────────────────
#define DHT_PIN        4
#define DHT_TYPE       DHT22

#define WINDOW_PIN     14   // North window reed switch
#define GARAGE_PIN     27   // Garage door reed switch

// ── Globals ───────────────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastReport = 0;

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);

  // Sensor pins — pulled up internally, sensor shorts to GND when closed
  pinMode(WINDOW_PIN, INPUT_PULLUP);
  pinMode(GARAGE_PIN, INPUT_PULLUP);

  dht.begin();

  Serial.println("[ESP32] Connecting to WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[ESP32] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
}

// ── Main loop ──────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();
  if (now - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = now;
    sendReport();
  }
}

// ── Read sensors and POST to server ───────────────────────────────────────────
void sendReport() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[ESP32] WiFi disconnected, skipping report.");
    return;
  }

  // Read DHT22
  float tempC  = dht.readTemperature();
  float tempF  = dht.readTemperature(true);   // Fahrenheit
  float humid  = dht.readHumidity();

  bool dhtOk = !isnan(tempF) && !isnan(humid);

  // Read contact sensors (LOW = closed/normal, HIGH = open)
  bool windowOpen = digitalRead(WINDOW_PIN) == HIGH;
  bool garageOpen = digitalRead(GARAGE_PIN) == HIGH;

  // Build JSON payload
  // Each key under "sensors" becomes a named sensor on the server.
  // Use descriptive names — they appear in GET /sensors/:name
  StaticJsonDocument<512> doc;
  JsonObject sensors = doc.createNestedObject("sensors");

  doc["auth"] = AUTH_TOKEN;

  if (dhtOk) {
    JsonObject temp = sensors.createNestedObject("temp-attic");
    temp["value"] = tempF;
    temp["unit"]  = "F";
    JsonObject tempMeta = temp.createNestedObject("metadata");
    tempMeta["location"] = "attic";
    tempMeta["celsius"]  = tempC;

    JsonObject hum = sensors.createNestedObject("humidity-attic");
    hum["value"] = humid;
    hum["unit"]  = "%";
    JsonObject humMeta = hum.createNestedObject("metadata");
    humMeta["location"] = "attic";
  } else {
    Serial.println("[ESP32] DHT read failed.");
  }

  // Window sensor
  JsonObject win = sensors.createNestedObject("window-north");
  win["value"] = windowOpen ? "open" : "closed";
  JsonObject winMeta = win.createNestedObject("metadata");
  winMeta["location"] = "north bedroom";

  // Garage door sensor
  JsonObject garage = sensors.createNestedObject("garage");
  garage["value"] = garageOpen ? "open" : "closed";
  JsonObject garageMeta = garage.createNestedObject("metadata");
  garageMeta["location"] = "main garage";

  // Serialize
  String body;
  serializeJson(doc, body);

  Serial.printf("[ESP32] Reporting: temp=%.1f°F hum=%.0f%% window=%s garage=%s\n",
    dhtOk ? tempF : 0.0,
    dhtOk ? humid : 0.0,
    windowOpen ? "OPEN" : "closed",
    garageOpen ? "OPEN" : "closed"
  );

  // POST to server
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + AUTH_TOKEN);

  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("[ESP32] Server responded: %d\n", code);
  } else {
    Serial.printf("[ESP32] HTTP error: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}
