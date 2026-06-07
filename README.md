# Low-Cost STM32 Power Quality Analyzer with IoT Web Dashboard

A portable, sub-₹2,500 power quality analyzer built around the **STM32F411 "Black Pill"** that measures live mains parameters — RMS voltage & current, real/apparent/reactive power, power factor, frequency, and harmonic distortion (THD) — displays them on a local TFT screen, and streams them over WiFi (ESP8266) to a browser-based dashboard with live charts, threshold alerts, and CSV export.

Built as an affordable alternative to commercial analyzers (Fluke 435-II, Hioki PQ3198) that cost ₹50,000+. Validated against a calibrated Fluke 117 multimeter — RMS within ±1.6%, frequency within ±0.06%, real power within ±2.2%.

## Demo

The analyzer running on real 230 V mains — live readings on the TFT and the web dashboard updating in real time:

https://github.com/V-Nandanwar/Power-Quality-Analyzer/releases/download/v1.0/Power_Quality_Analyzer.mp4

> If the player above doesn't load, [download / watch the demo here](https://github.com/V-Nandanwar/Power-Quality-Analyzer/releases/download/v1.0/Power_Quality_Analyzer.mp4).

---

## What it does

| Parameter | Method |
|---|---|
| RMS Voltage / Current | True RMS over a full mains cycle from sampled waveforms |
| Frequency | Zero-crossing detection |
| Real / Apparent / Reactive Power | Instantaneous power averaging + V·I products |
| Power Factor | Real ÷ Apparent power |
| Harmonics & THD | Goertzel algorithm, up to the 10th harmonic |
| Alerts | Voltage sag/swell, low PF, high THD, frequency deviation → buzzer + LED + dashboard flag |

## How it works

```
230V AC mains ──┬── ZMPT101B (voltage sensor, isolated) ──┐
                └── SCT-013 (clamp current sensor) ────────┤
                                                           ▼
                                              STM32F411 Black Pill
                                              • Dual-channel ADC + DMA @ 6.4 kHz
                                              • RMS / power / frequency / THD
                                                           │
                                         ┌─────────────────┼──────────────────┐
                                         ▼                                     ▼
                                   1.8" TFT (SPI)                  ESP8266 (UART, JSON @ 5 Hz)
                                   live local readout              web server + dashboard
```

Both sensors are galvanically isolated, and the electronics run off separate battery packs — the microcontroller circuit never has direct contact with mains voltage.

## Repository layout

| Path | Contents |
|---|---|
| [`STM_Code/`](STM_Code/) | STM32F411 firmware (C, STM32CubeIDE). Signal acquisition, DSP, UART output. See its [build & flash guide](STM_Code/README.md). |
| [`ESP_Code/`](ESP_Code/) | ESP8266 firmware (Arduino) — receives UART JSON, hosts the web server. |
| [`website/`](website/) | Browser dashboard — live values, history charts, alerts, multi-device fleet view. HTML/CSS/JS, Chart.js. |
| [`Project_Description_and_BOM.md`](Project_Description_and_BOM.md) | Full design writeup, architecture, pinout, and bill of materials. |
| `Midsem_Review_Report` / `Endsem_Review_Report` | Course review reports documenting design and validation. |

## Tech stack

- **MCU firmware:** C, STM32CubeIDE, STM32 HAL, Goertzel DSP, DMA-driven ADC
- **WiFi/IoT:** ESP8266 (Arduino core), UART + JSON, async web server
- **Dashboard:** HTML / CSS / JavaScript, Chart.js
- **Sensors:** ZMPT101B (voltage), SCT-013-005 (current)

## Bill of materials

~₹2,310 total. Full breakdown in [Project_Description_and_BOM.md](Project_Description_and_BOM.md).

---

*Embedded System Design course project (ET3271), Semester VI — Electronics & Telecommunication Engineering, Vishwakarma Institute of Technology, Pune. Author: Vedant Nandanwar.*
