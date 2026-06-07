// Configuration for the Power Quality Analyzer dashboard.
// Swap DATA_SOURCE to 'http' or 'ws' tomorrow when the ESP8266 is online.

const CONFIG = {
  // 'mock' | 'http' | 'ws'
  DATA_SOURCE: 'mock',

  // Used when DATA_SOURCE === 'http'  (ESP8266 GET /data, polled)
  HTTP_URL: 'http://192.168.1.50/data',
  POLL_MS: 100,

  // Used when DATA_SOURCE === 'ws'   (ESP8266 WebSocket push)
  WS_URL: 'ws://192.168.1.50/ws',

  // Mock emission rate
  MOCK_INTERVAL_MS: 100,

  // Visible window on the trend/power line charts (how many recent points show on-screen).
  // All data is still captured for CSV export; this only controls what's plotted.
  TREND_VISIBLE_POINTS: 50,
  HISTORY_MAX: 18000,   // CSV export buffer; ~30 min at 10 Hz

  // Alert smoothing: threshold checks run against a moving average over this window.
  // Prevents noisy signals dithering on the threshold line from flipping alerts.
  ALERT_AVG_WINDOW_MS: 500,

  // Hysteresis gap for each alert: once the alert fires, the measurement must
  // cross *past* the threshold by this amount before the alert clears. Kills
  // residual flipping when the averaged value sits right on the trip line.
  HYSTERESIS: {
    v:    2.0,   // volts      (e.g. sag trips at 207 V, clears at 209 V)
    pf:   0.02,  // power factor
    thd:  0.5,   // percent
    freq: 0.05,  // Hz
  },

  // Default alert thresholds (per project doc section 5.10)
  DEFAULT_THRESHOLDS: {
    v_sag: 207,      // volts; below this = sag
    v_swell: 253,    // volts; above this = swell
    pf_min: 0.85,    // minimum acceptable power factor
    thd_max: 8,      // percent
    freq_min: 49.5,  // Hz
    freq_max: 50.5,  // Hz
    i_min_for_pf: 0.05,  // current below this: PF is meaningless ("—")
  },
};
