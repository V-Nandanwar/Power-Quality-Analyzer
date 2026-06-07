/*
 * ESP_Code.ino — ESP32 DevKit firmware for the Power Quality Analyzer
 *
 * Role: receive measurement packets from the STM32 over UART2, cache the
 * latest one, and serve it as JSON on GET /data so the browser dashboard
 * (website/index.html) can poll it.
 *
 * WIRING (different from the ESP8266 version!):
 *   STM32 PA9  (TX) ─────► ESP32 GPIO16 (UART2 RX, silk "RX2" or "D16")
 *   STM32 PA10 (RX) ◄───── ESP32 GPIO17 (UART2 TX, silk "TX2" or "D17")
 *   STM32 GND       ◄────► ESP32 GND     (must be common with STM32 GND)
 *
 * The ESP32's USB connector uses UART0 (Serial). We keep that for debug
 * output to the Arduino Serial Monitor. The link to the STM32 is on UART2,
 * so flashing the ESP32 over USB doesn't interfere with the STM32 wire — no
 * need to disconnect anything during upload.
 *
 * Required Arduino libraries:
 *   - ESP32 board package (Tools → Boards Manager → "esp32" by Espressif)
 *   - ArduinoJson by Benoit Blanchon (Library Manager) — v6.x
 *
 * Board: "ESP32 Dev Module". Upload speed 921600.
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <time.h>
#include <math.h>
#include <HardwareSerial.h>

/* ========================================================================= */
/* USER CONFIG — fill these in before flashing                                */
/* ========================================================================= */
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

/* Optional: static IP. Leave commented for DHCP. The dashboard's HTTP_URL
 * (website/js/machines.js) must point at whatever IP the ESP gets — using a
 * static one makes that easier. */
// #define USE_STATIC_IP
#ifdef USE_STATIC_IP
  static IPAddress IP_LOCAL  (192, 168, 1, 50);
  static IPAddress IP_GATEWAY(192, 168, 1, 1);
  static IPAddress IP_SUBNET (255, 255, 255, 0);
  static IPAddress IP_DNS    (192, 168, 1, 1);
#endif

/* NTP — used to give each /data response a real epoch-ms timestamp.
 * IST = UTC + 5:30 = 19800 seconds. Adjust if you're elsewhere. */
static const long  NTP_GMT_OFFSET_SEC = 19800;
static const int   NTP_DST_OFFSET_SEC = 0;
static const char* NTP_SERVER         = "pool.ntp.org";

/* UART2 pins (default for most ESP32 DevKits) */
static const int STM32_UART_RX_PIN = 16;
static const int STM32_UART_TX_PIN = 17;

/* ========================================================================= */
/* Globals                                                                     */
/* ========================================================================= */
WebServer server(80);
HardwareSerial STM32Serial(2);   /* UART2 */

struct Packet {
  float v_rms      = 0.0f;
  float i_rms      = 0.0f;
  float freq       = 0.0f;
  float pf         = 0.0f;
  float p_real     = 0.0f;
  float p_app      = 0.0f;
  float p_reac     = 0.0f;
  float thd        = 0.0f;
  float harmonics[10] = {0};   /* raw amplitudes (volts), as STM32 computed   */
  uint8_t alert    = 0;
  unsigned long last_rx_ms = 0;
};

static Packet latest;
static String rxBuf;
static bool   ntp_ready = false;

/* ========================================================================= */
/* Time helpers                                                                */
/* ========================================================================= */
static uint64_t epoch_ms() {
  if (!ntp_ready) {
    time_t now = time(nullptr);
    if (now > 1700000000) ntp_ready = true;
  }
  if (ntp_ready) {
    timeval tv;
    gettimeofday(&tv, nullptr);
    return (uint64_t)tv.tv_sec * 1000ULL + (uint64_t)tv.tv_usec / 1000ULL;
  }
  return (uint64_t)millis();
}

/* ========================================================================= */
/* UART line parser — STM32 sends one JSON line per packet, terminated by \n. */
/* ========================================================================= */
static void handle_line(const String& line) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, line);
  if (err) {
    Serial.print("JSON parse error: ");
    Serial.println(err.c_str());
    return;
  }

  Packet p;
  p.v_rms  = doc["v"]    | 0.0f;
  p.i_rms  = doc["i"]    | 0.0f;
  p.freq   = doc["f"]    | 0.0f;
  p.p_real = doc["p"]    | 0.0f;
  p.p_app  = doc["s"]    | 0.0f;
  p.p_reac = doc["q"]    | 0.0f;
  p.pf     = doc["pf"]   | 0.0f;
  p.thd    = doc["thd"]  | 0.0f;
  p.alert  = doc["alert"]| 0;

  JsonArray h = doc["h"].as<JsonArray>();
  if (!h.isNull()) {
    for (int i = 0; i < 10 && i < (int)h.size(); i++) {
      p.harmonics[i] = h[i] | 0.0f;
    }
  }

  p.last_rx_ms = millis();
  noInterrupts();
  latest = p;
  interrupts();
}

static void poll_uart() {
  while (STM32Serial.available()) {
    char c = (char)STM32Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (rxBuf.length() > 0) {
        handle_line(rxBuf);
        rxBuf = "";
      }
    } else {
      rxBuf += c;
      if (rxBuf.length() > 512) rxBuf = "";
    }
  }
}

/* ========================================================================= */
/* Waveform synthesis (matches website/js/mock.js generateWaveform)            */
/* ========================================================================= */
static void build_harmonics_pct(const Packet& p, float* out_pct) {
  float fund = (p.harmonics[0] > 0.001f) ? p.harmonics[0] : 1.0f;
  out_pct[0] = 100.0f;
  for (int i = 1; i < 10; i++) {
    out_pct[i] = (p.harmonics[i] / fund) * 100.0f;
    if (out_pct[i] < 0) out_pct[i] = 0;
  }
}

static void build_waveform(const Packet& p, const float* harmonics_pct, float* out_wf, int N) {
  float v_peak = p.v_rms * 1.41421356f;       /* sqrt(2)                     */
  for (int n = 0; n < N; n++) {
    float sum = 0.0f;
    for (int h = 0; h < 10; h++) {
      float amp = v_peak * (harmonics_pct[h] / 100.0f);
      sum += amp * sinf(2.0f * (float)M_PI * (float)(h + 1) * (float)n / (float)N);
    }
    out_wf[n] = sum;
  }
}

/* ========================================================================= */
/* HTTP handlers                                                               */
/* ========================================================================= */
static void send_cors_headers() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Cache-Control", "no-store");
}

static void handle_options_data() {
  send_cors_headers();
  server.send(204);
}

static void handle_get_data() {
  Packet p;
  noInterrupts();
  p = latest;
  interrupts();

  float harmonics_pct[10];
  build_harmonics_pct(p, harmonics_pct);

  static float wf[128];
  build_waveform(p, harmonics_pct, wf, 128);

  DynamicJsonDocument doc(4096);
  doc["ts"]     = (double)epoch_ms();
  doc["v_rms"]  = p.v_rms;
  doc["i_rms"]  = p.i_rms;
  doc["freq"]   = p.freq;
  doc["pf"]     = p.pf;
  doc["p_real"] = p.p_real;
  doc["p_app"]  = p.p_app;
  doc["p_reac"] = p.p_reac;
  doc["thd"]    = p.thd;
  doc["alert"]  = p.alert;
  doc["stale_ms"] = (uint32_t)(millis() - p.last_rx_ms);

  JsonArray h = doc.createNestedArray("harmonics");
  for (int i = 0; i < 10; i++) h.add(harmonics_pct[i]);

  JsonArray w = doc.createNestedArray("waveform");
  for (int i = 0; i < 128; i++) w.add(wf[i]);

  String out;
  out.reserve(2200);
  serializeJson(doc, out);

  send_cors_headers();
  server.send(200, "application/json", out);
}

static void handle_get_root() {
  String html;
  html.reserve(1024);
  html += F("<!doctype html><meta charset='utf-8'><title>PQA ESP32</title>");
  html += F("<style>body{font:14px monospace;padding:20px;background:#111;color:#0f0}h1{color:#fff}</style>");
  html += F("<h1>Power Quality Analyzer — ESP32 gateway</h1>");
  html += F("<p>Status: ONLINE</p>");
  html += "<p>SSID: " + WiFi.SSID() + "</p>";
  html += "<p>IP: "   + WiFi.localIP().toString() + "</p>";
  html += "<p>Uptime: " + String(millis() / 1000) + " s</p>";
  html += "<p>Last STM32 packet: " + String((millis() - latest.last_rx_ms)) + " ms ago</p>";
  html += "<p>NTP synced: " + String(ntp_ready ? "yes" : "no") + "</p>";
  html += F("<hr><p>Endpoints:</p><ul>");
  html += F("<li><a href='/data'>/data</a> — JSON for the dashboard</li>");
  html += F("<li><a href='/raw'>/raw</a> — raw last STM32 line (debug)</li>");
  html += F("</ul>");
  send_cors_headers();
  server.send(200, "text/html", html);
}

static void handle_get_raw() {
  Packet p;
  noInterrupts();
  p = latest;
  interrupts();
  String s;
  s += "v_rms="   + String(p.v_rms,  3) + "\n";
  s += "i_rms="   + String(p.i_rms,  3) + "\n";
  s += "freq="    + String(p.freq,   2) + "\n";
  s += "pf="      + String(p.pf,     3) + "\n";
  s += "p_real="  + String(p.p_real, 1) + "\n";
  s += "p_app="   + String(p.p_app,  1) + "\n";
  s += "p_reac="  + String(p.p_reac, 1) + "\n";
  s += "thd="     + String(p.thd,    2) + "\n";
  s += "alert="   + String(p.alert)     + "\n";
  s += "h=[";
  for (int i = 0; i < 10; i++) {
    s += String(p.harmonics[i], 3);
    if (i < 9) s += ",";
  }
  s += "]\n";
  s += "stale_ms=" + String(millis() - p.last_rx_ms) + "\n";
  send_cors_headers();
  server.send(200, "text/plain", s);
}

static void handle_not_found() {
  send_cors_headers();
  server.send(404, "text/plain", "Not found");
}

/* ========================================================================= */
/* WiFi + NTP setup                                                            */
/* ========================================================================= */
static void wifi_connect() {
  Serial.println();
  Serial.print("Connecting to "); Serial.println(WIFI_SSID);

#ifdef USE_STATIC_IP
  WiFi.config(IP_LOCAL, IP_GATEWAY, IP_SUBNET, IP_DNS);
#endif
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print('.');
    if (millis() - start > 30000) {
      Serial.println("\nWiFi timeout — restarting");
      ESP.restart();
    }
  }
  Serial.println();
  Serial.print("WiFi up. IP: "); Serial.println(WiFi.localIP());
  Serial.print("Signal: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
}

static void ntp_start() {
  configTime(NTP_GMT_OFFSET_SEC, NTP_DST_OFFSET_SEC, NTP_SERVER);
  Serial.println("Waiting for NTP...");
  unsigned long start = millis();
  while (time(nullptr) < 1700000000 && (millis() - start) < 5000) {
    delay(200);
  }
  ntp_ready = (time(nullptr) > 1700000000);
  Serial.println(ntp_ready ? "NTP synced." : "NTP not synced (continuing with millis())");
}

/* ========================================================================= */
/* Arduino entry points                                                        */
/* ========================================================================= */
void setup() {
  /* USB serial = debug console */
  Serial.begin(115200);
  delay(200);
  Serial.println("\n\n=== PQA ESP32 gateway booting ===");

  /* UART2 = link to STM32 (115200 8N1) */
  STM32Serial.begin(115200, SERIAL_8N1, STM32_UART_RX_PIN, STM32_UART_TX_PIN);
  Serial.printf("UART2 ready: RX=GPIO%d  TX=GPIO%d\n", STM32_UART_RX_PIN, STM32_UART_TX_PIN);

  wifi_connect();
  ntp_start();

  server.on("/",     HTTP_GET,     handle_get_root);
  server.on("/data", HTTP_GET,     handle_get_data);
  server.on("/data", HTTP_OPTIONS, handle_options_data);
  server.on("/raw",  HTTP_GET,     handle_get_raw);
  server.onNotFound(handle_not_found);
  server.begin();
  Serial.println("HTTP server up on :80");
  Serial.print("Dashboard URL: http://"); Serial.print(WiFi.localIP()); Serial.println("/data");
}

void loop() {
  poll_uart();
  server.handleClient();

  static unsigned long last_check = 0;
  if (millis() - last_check > 5000) {
    last_check = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi dropped — reconnecting");
      WiFi.reconnect();
    }
  }
}
