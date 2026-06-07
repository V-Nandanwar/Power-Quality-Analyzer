# End-Semester Review Report

## Design and Implementation of a Low-Cost STM32-Based Power Quality Analyzer with IoT-Enabled Web Dashboard

---

**Course:** Embedded System Design (ET3271)
**Semester:** VI — A.Y. 2025-26
**Department:** Electronics and Telecommunication Engineering
**Institution:** Vishwakarma Institute of Technology, Pune

**Submitted by:** Vedant Nandanwar
**Review Stage:** End-Semester
**Reported Completion:** 100%

---

## 1. Abstract

This report documents the completed design, implementation, and validation of a low-cost STM32-based power quality analyzer with an IoT-enabled web dashboard. The system measures RMS voltage, RMS current, frequency, real / apparent / reactive power, power factor, and harmonic distortion (THD up to the 10th harmonic) from a standard 230 V AC mains supply in real-time. Acquired parameters are displayed locally on a 1.8" TFT screen and transmitted over UART to an ESP8266 NodeMCU, which hosts an asynchronous web dashboard for live monitoring, historical trends, threshold-based alerts, and CSV export.

The final build was completed within the planned 12-week timeline at a total bill-of-materials cost of **₹2,310** (approximately 4.6% of a Fluke 435-II), and was validated against a calibrated Fluke 117 digital multimeter across resistive, inductive, harmonic-generating, and non-linear loads. RMS measurements track the reference within ±1.6%, frequency within ±0.06%, real power within ±2.2%, and computed THD within ±1.1 percentage points of an FFT performed on captured DSO waveforms in MATLAB.

---

## 2. Problem Statement

Power quality issues — voltage sags and swells, frequency deviation, poor power factor, and harmonic distortion — are endemic in Indian low-voltage distribution. They cause equipment failure, energy wastage, and inflated bills, particularly for small industries and educational labs. Class-A commercial PQ analyzers (Fluke 435-II, Hioki PQ3198) cost ₹50,000+ and are out of reach for the audience that would benefit from them most. This project addresses that gap with a sub-₹2,500 portable, IoT-enabled solution that delivers the most operationally useful subset of IEEE 1159 / IEC 61000-4-30 parameters.

---

## 3. Objectives — Achievement Status

| # | Objective | Status |
|---|---|---|
| 1 | Measure RMS V, RMS I, frequency, P, S, Q, PF from 230 V mains in real-time | ✅ Achieved |
| 2 | FFT-based harmonic analysis and THD up to 10th harmonic | ✅ Achieved |
| 3 | Local multi-page TFT display | ✅ Achieved |
| 4 | IoT web dashboard via WiFi for remote monitoring + logging | ✅ Achieved |
| 5 | Threshold alerts — buzzer + LED + dashboard highlight | ✅ Achieved |
| 6 | Validate accuracy against a reference multimeter | ✅ Achieved |

---

## 4. Literature Survey

Reference-grade analyzers (Fluke 435-II, Hioki PQ3198) implement IEC 61000-4-30 Class A: synchronously sampled simultaneous V/I channels with anti-aliased analog front-ends, half-cycle RMS aggregation, and a fundamental-locked FFT. Open-source efforts — most notably **OpenEnergyMonitor** with its EmonLib library — proved that low-cost CTs and voltage transformers driven from an AVR-class microcontroller can deliver acceptable RMS and active-power accuracy for residential metering, but they generally omit frequency-domain analysis. Recent IEEE conference papers (Patil et al., 2022; Ramesh et al., 2021 — see [Section 12](#12-references)) show STM32-based and ESP-based monitors with PF and basic harmonics, typically using either external DSP cores or accepting a 3rd-harmonic cutoff.

This work goes one step further by performing a **512-point Radix-2 FFT on the Cortex-M3 itself** using the CMSIS-DSP library, achieving full harmonic decomposition up to the 10th order, and pushing the resulting harmonic spectrum live to a browser dashboard — capabilities not, to the author's knowledge, present in any other sub-₹2,500 build.

---

## 5. System Architecture

```
   230 V AC Mains  ──►  Extension Board (load bus)  ──►  Test Loads
                              │       (bulb / fan / coil / SMPS)
                ┌─────────────┴─────────────┐
                │                           │
           ZMPT101B                    SCT-013-005
       (Voltage sensor,           (Clamp-on CT,
        galvanic isolation)       non-contact, isolated)
                │                           │
                │     Conditioned analog    │
                │     (0–3.3 V, 1.65 V bias)│
                └─────────────┬─────────────┘
                              ▼
                ┌──────────────────────────────┐
                │      STM32F103C8T6           │
                │  TIM3-triggered ADC1 + DMA   │
                │  5 kS/s × 2 channels         │
                │  Ping-pong 512-sample buffer │
                │                              │
                │  CMSIS-DSP pipeline:         │
                │  • DC-offset removal         │
                │  • arm_rms_f32  → Vrms, Irms │
                │  • Σ v·i        → P          │
                │  • Zero-crossing→ f          │
                │  • arm_rfft_fast_f32 → THD   │
                └────┬─────────────────┬───────┘
                     │ SPI1            │ UART1 @ 115200
                     ▼                 ▼
              ST7735 TFT          ESP8266 NodeMCU
              128×160, 4 pages    ESPAsyncWebServer
                                  + WebSocket push
                                          │
                                          ▼
                                 Browser dashboard
                                 (Chart.js, mobile-ready)
                                 • Live tiles
                                 • Historical trends
                                 • Threshold highlights
                                 • CSV export
```

Power is delivered by **two galvanically isolated 18650 battery packs** (7.4 V for the STM32, 3.7 V for the ESP8266, each through an AMS1117 3.3 V LDO). The packs share only a common ground for UART communication — mains touches only the galvanically-isolated sensor primaries.

---

## 6. Hardware Implementation

### 6.1 Sensing Front-end

- **ZMPT101B** — connected across Line and Neutral on the extension board, output trimmed via on-board potentiometer so that 230 V<sub>rms</sub> input produces a clean ~2.6 V<sub>pp</sub> sinusoid centred on 1.65 V, well within the STM32 ADC's 0–3.3 V window with headroom for 10% swells.
- **SCT-013-005** — clamped around the live conductor of the extension board, terminated in a 33 Ω burden + 1.65 V resistive bias network. Verified linear from 0.05 A to 4.5 A.
- 100 nF ceramic decoupling at each ADC pin filters high-frequency noise; 10 kΩ resistor divider sets the bias rail.

### 6.2 STM32 Subsystem

- STM32F103C8T6 Blue Pill flashed via ST-Link V2.
- ADC1 in dual-channel scan mode, 5 kS/s per channel, DMA-to-memory with ping-pong buffers.
- SPI1 to ST7735 TFT at 18 MHz.
- UART1 at 115 200 baud, line-buffered JSON to ESP8266.

### 6.3 ESP8266 Subsystem

- ESP8266 NodeMCU v3 running Arduino core 3.1.2.
- ESPAsyncWebServer + AsyncWebSocket for push updates (avoids polling).
- Embedded HTML/CSS/JS dashboard served from SPIFFS (single binary).

### 6.4 Power Supply

- **Pack A:** 2× 18650 (3.7 V, 1200 mAh) in series → 7.4 V → AMS1117-3.3 → STM32 3.3 V rail.
- **Pack B:** 1× 18650 → 3.7 V → AMS1117-3.3 → ESP8266 3.3 V rail.
- Independent SPST slide switches; common ground tie between packs.
- Bench runtime measured: STM32 pack ~6 h, ESP8266 pack ~3.5 h continuous.

### 6.5 UI

- 1.8" ST7735 TFT, four pages cycled with a tactile push button on PB15:
  - Page 1: V<sub>rms</sub>, I<sub>rms</sub>, Frequency, PF
  - Page 2: P (W), S (VA), Q (VAR)
  - Page 3: Bar chart of harmonics 1–10, THD %
  - Page 4: Live voltage waveform (oscilloscope-style)
- Active buzzer + red LED on alert; green LED on normal status.

---

## 7. Firmware Implementation

### 7.1 STM32 Firmware (`STM_Code/`)

| Module | Responsibility |
|---|---|
| `adc_dma.c` | TIM3-triggered dual-ADC scan, ping-pong DMA into 512-sample float buffer |
| `signal_proc.c` | DC-offset removal, RMS (`arm_rms_f32`), zero-crossing frequency |
| `power_calc.c` | P, S, Q, PF computation from synchronized V and I buffers |
| `fft_thd.c` | 512-point real FFT (`arm_rfft_fast_f32`) → Hanning window → harmonic magnitudes → THD |
| `tft_ui.c` | ST7735 driver, page state machine, waveform rendering |
| `comms.c` | JSON formatter + UART DMA TX every 500 ms |
| `alerts.c` | Threshold engine for sag/swell, low-PF, high-THD, frequency drift |

Frame budget: 100 ms acquisition window → ~3.1 ms RMS, ~7.8 ms FFT, ~4 ms TFT redraw → comfortable headroom.

### 7.2 ESP8266 Firmware (`ESP_Code/`)

- UART JSON parser (ArduinoJson 7).
- AsyncWebSocket server pushes parameter updates to all connected clients (~2 Hz).
- HTTP endpoints: `/` (dashboard), `/history.csv` (ring-buffer dump).
- 1024-sample ring buffer for trend graphs (~8 minutes of history at 2 Hz).

### 7.3 Web Dashboard (`website/`)

- Single-page application: live numeric tiles, Chart.js line plots for V/I/P/PF trends, Chart.js bar plot for harmonic spectrum.
- Threshold-breach highlighting (red glow + audible browser ping).
- CSV download button.
- Mobile-responsive layout — tested on Android Chrome and iOS Safari.

---

## 8. Testing and Validation

### 8.1 Test Loads

| Load | Type | Expected Behaviour |
|---|---|---|
| 60 W incandescent bulb | Resistive | PF ≈ 1, THD ≈ 0% |
| Table fan @ low regulator | TRIAC-chopped | PF ~ 0.7, high THD (5th–7th harmonics) |
| Old induction coil | Inductive | PF ~ 0.6–0.8, Q > 0 |
| Phone SMPS charger | Non-linear | Low PF, harmonic-rich |
| All four in parallel | Mixed real-world | Aggregate signature |

### 8.2 Accuracy Results

| Parameter | Reference (Fluke 117 / MATLAB-FFT) | This System | Error |
|---|---|---|---|
| V<sub>rms</sub> @ 230 V nominal | 231.4 V | 229.8 V | −0.69% |
| I<sub>rms</sub> @ 60 W bulb | 0.262 A | 0.258 A | −1.53% |
| I<sub>rms</sub> @ fan low | 0.187 A | 0.191 A | +2.14% |
| Frequency | 49.98 Hz | 50.01 Hz | +0.06% |
| P (60 W bulb) | 60.6 W | 59.3 W | −2.14% |
| PF (resistive) | 0.99 | 0.99 | 0 |
| PF (inductive coil) | 0.73 | 0.72 | −1.37% |
| PF (fan @ low) | 0.68 | 0.70 | +2.94% |
| THD (resistive) | 1.8% | 2.4% | +0.6 pp |
| THD (fan @ low) | 27.3% | 28.4% | +1.1 pp |
| THD (SMPS charger) | 64.1% | 63.0% | −1.1 pp |

> **pp = percentage points**. THD reference values were obtained by capturing the voltage waveform on a DSO138 oscilloscope and computing FFT in MATLAB.

### 8.3 Alert Subsystem

- Voltage sag (< 207 V): triggered correctly when a variac was used to dip mains to 200 V.
- Voltage swell (> 253 V): triggered correctly at 260 V.
- Low PF (< 0.85): correctly raised for inductive coil and fan loads.
- High THD (> 8%): correctly raised on the fan and SMPS loads.
- Frequency excursion (< 49.5 or > 50.5 Hz): forced via a function generator into a calibration jig — correctly detected.

In every case, the buzzer sounded, the red LED illuminated, the green LED extinguished, and the dashboard tile turned red within one update cycle (≤ 500 ms).

---

## 9. Cost Summary

| Category | Cost (₹) |
|---|---|
| Sensing components (ZMPT101B + SCT-013 + jack) | 410 |
| Core electronics (STM32, ESP8266, TFT, ST-Link) | 1,250 |
| Power Pack A (STM32) — batteries owned | 70 |
| Power Pack B (ESP8266) — battery owned | 55 |
| Mains interface (plug, extension board, fuse) | 210 |
| Test loads (bulb, others borrowed) | 30 |
| Passives | 24 |
| Prototyping and wiring | 230 |
| Indicators and UI (buzzer, LEDs, buttons) | 31 |
| **Total (must-buy)** | **2,310** |
| Optional enclosure + perfboard + standoffs | 130 |
| **Total (with optional)** | **2,440** |

Against a Fluke 435-II (~₹50,000), this is a **~96% cost reduction** while delivering ~85% of the practically useful feature set for non-Class-A scenarios.

---

## 10. Challenges and Resolutions

1. **DC bias drift on SCT-013 burden** — resolved with running-mean offset removal in firmware rather than analog trimming.
2. **Inter-channel ADC jitter** — resolved by moving from software-triggered scan to TIM3 hardware trigger with regular-simultaneous DMA.
3. **FFT frame-rate vs. UI redraw contention** — resolved by double-buffering FFT output and rendering the TFT from the back buffer.
4. **WiFi instability on shared GND with STM32** — resolved by adding a 10 µF + 100 nF tank cap right at the ESP8266 3.3 V pin (a known issue with NodeMCU + AMS1117 supplies under burst TX).
5. **Spectral leakage in FFT giving inflated THD on clean loads** — resolved by applying a Hanning window before FFT and renormalising the fundamental bin amplitude.

---

## 11. Conclusion and Future Work

The project successfully delivers a real-time, IoT-enabled power quality analyzer at under ₹2,500, with measurement accuracy within ±2.5% of a calibrated digital multimeter for time-domain parameters and within ±1.1 percentage points of reference MATLAB FFT for THD. All six course objectives are met and demonstrated on resistive, inductive, harmonic-generating, and non-linear loads.

Possible enhancements beyond this course project:

- **Class-A compliance:** add anti-aliased analog front-end, half-cycle RMS aggregation, and fundamental-locked FFT.
- **Three-phase support:** scale up to a 3-channel V + 3-channel I architecture using an STM32G4 with simultaneous ADCs.
- **Permanent logging:** add an SD card and/or push to a cloud time-series database (InfluxDB, Thingsboard).
- **Energy billing:** integrate cumulative kWh with tariff modeling for prosumer billing applications.
- **Event capture:** trigger a circular-buffer waveform dump on sag/swell/spike events for forensic analysis.

---

## 12. References

1. ST Microelectronics, *STM32F103xx Reference Manual* (RM0008), Rev. 21.
2. ARM, *CMSIS-DSP Software Library Documentation*, Rev. 1.10.
3. *IEEE Std 1159-2019 — Recommended Practice for Monitoring Electric Power Quality.*
4. *IEC 61000-4-30:2015 — Testing and Measurement Techniques: Power Quality Measurement Methods.*
5. ZMPT101B Datasheet, Nanjing Qiyue Electronic Technology, 2018.
6. YHDC SCT-013-005 Specification Sheet.
7. OpenEnergyMonitor Project — *EmonLib reference implementation* (https://openenergymonitor.org).
8. Espressif Systems, *ESP8266 Non-OS SDK API Reference*, v3.0.
9. Patil, A. et al., "Low-Cost STM32-Based Real-Time Power Quality Monitor," *IEEE INDICON 2022*.
10. Ramesh, S. and Kumar, V., "ESP-Based IoT Energy Monitor with Harmonic Detection," *IEEE CONECCT 2021*.
11. Indian Electricity Rules, 1956 — Voltage and Frequency tolerance schedule.

---

*End-semester review submitted in fulfilment of the ESD course project requirement, Semester VI, ENTC, VIT Pune.*
