# Mid-Semester Review Report

## Design and Implementation of a Low-Cost STM32-Based Power Quality Analyzer with IoT-Enabled Web Dashboard

---

**Course:** Embedded System Design (ET3271)
**Semester:** VI — A.Y. 2025-26
**Department:** Electronics and Telecommunication Engineering
**Institution:** Vishwakarma Institute of Technology, Pune

**Submitted by:** Vedant Nandanwar
**Review Stage:** Mid-Semester
**Reported Completion:** ~55%

---

## 1. Abstract

This project develops a low-cost, portable power quality monitoring system built around the STM32F103C8T6 microcontroller. The system measures RMS voltage, RMS current, frequency, real/apparent/reactive power, power factor, and harmonic distortion (THD) from a 230 V AC mains supply in real-time. An ESP8266 WiFi module transmits the acquired data to a web-based dashboard for remote monitoring, logging, and threshold-based alerts. The system targets an end-to-end build cost under ₹2,500 — roughly 5% of the price of comparable commercial instruments such as the Fluke 435-II or Hioki PQ3198.

This mid-semester review documents the work completed in weeks 1–7 of the planned 12-week timeline, the calibration results obtained against reference instruments, and the work pending for the second half of the semester.

---

## 2. Problem Statement

Indian distribution networks frequently exhibit poor voltage regulation, frequency drift, and harmonic pollution introduced by non-linear loads (SMPS, TRIAC dimmers, VFDs). These disturbances cause equipment damage, energy wastage, and increased electricity bills. Commercial PQ analyzers cost upwards of ₹50,000, which puts them out of reach of small-scale industries, educational labs, and field technicians. The objective of this project is to deliver an open, IoT-enabled alternative at less than 5% of that cost.

---

## 3. Objectives

1. Measure RMS voltage, RMS current, frequency, real power, apparent power, reactive power, and power factor from 230 V AC mains in real-time.
2. Perform FFT-based harmonic analysis to compute Total Harmonic Distortion (THD) up to the 10th harmonic.
3. Display all parameters on a local TFT screen with multiple pages.
4. Transmit data to a web dashboard via WiFi for remote monitoring and data logging.
5. Generate alerts (buzzer + LED + dashboard highlight) when parameters exceed user-defined thresholds.
6. Validate measurement accuracy against a calibrated multimeter and oscilloscope.

---

## 4. Literature Survey (Summary)

Reference instruments such as the Fluke 435-II implement an IEC 61000-4-30 Class A pipeline: anti-aliased simultaneous sampling, half-cycle RMS aggregation, and FFT-based harmonic decomposition referenced to a synchronously-tracked fundamental. Open-source projects — most notably **OpenEnergyMonitor (EmonLib)** — have shown that a low-cost microcontroller with a CT and a voltage transformer can deliver acceptable RMS and real-power accuracy for residential monitoring, but typically omit harmonic analysis and frequency-domain features. Several IEEE papers (cited in [Section 11](#11-references)) report STM32-based and ESP-based monitors that handle RMS and power factor but use either external DSP co-processors or skip THD entirely.

The architectural choice in this work is to keep all DSP on the STM32 itself, using the **CMSIS-DSP** library's optimized Radix-2 FFT to obtain harmonics on a Cortex-M3 — an approach validated in literature for sample frames up to 512 points at 5 kHz.

---

## 5. System Architecture

```
   230 V AC Mains  ──► Extension Board  ──►  Test Loads
                            │
              ┌─────────────┴─────────────┐
              │                           │
         ZMPT101B                     SCT-013-005
       (Voltage sensor)           (Clamp-on CT)
              │                           │
              │     Isolated analog       │
              └────────────┬──────────────┘
                           ▼
                ┌──────────────────────┐
                │   STM32F103C8T6      │
                │  • Dual-ADC + DMA    │
                │  • RMS, P, Q, PF     │
                │  • Zero-crossing f   │
                │  • CMSIS-DSP FFT     │
                └──┬───────────────┬───┘
                   │ SPI           │ UART (JSON)
                   ▼               ▼
            1.8" TFT (ST7735)   ESP8266 NodeMCU
                                  │
                                  ▼
                          Browser dashboard
                          (live + history + alerts)
```

Two independent 18650 battery packs (7.4 V for STM32 via AMS1117, 3.7 V for ESP8266) provide isolated DC supply, sharing only a common ground for UART. Mains is touched only through galvanically-isolated sensors.

---

## 6. Methodology

### 6.1 Signal Acquisition

The STM32's ADC1 samples PA0 (voltage) and PA1 (current) at **5 kS/s per channel** (100 samples per 50 Hz cycle) using a TIM3-triggered scan with DMA-to-memory transfer. This achieves zero-CPU-overhead acquisition into a 512-sample ping-pong buffer.

### 6.2 RMS, Frequency, and Power Computation

For each acquired frame:

| Quantity | Formula |
|---|---|
| V<sub>rms</sub> | √( (1/N) · Σ v[n]² ) |
| I<sub>rms</sub> | √( (1/N) · Σ i[n]² ) |
| Frequency | 1 / Δt between two consecutive positive-going zero crossings |
| Real Power P | (1/N) · Σ v[n]·i[n] |
| Apparent Power S | V<sub>rms</sub> · I<sub>rms</sub> |
| Reactive Power Q | √(S² − P²) |
| Power Factor | P / S |

DC offset (introduced by the 1.65 V mid-rail bias) is removed by subtracting a running mean before squaring.

### 6.3 FFT and THD *(planned for second half)*

A 512-point Radix-2 FFT via `arm_rfft_fast_f32` will yield harmonic magnitudes; THD is computed as `√(Σ V<sub>h</sub>²) / V<sub>1</sub>` for h = 2…10.

---

## 7. Work Completed (Weeks 1–7)

### 7.1 Hardware

- ✅ All components procured (STM32 Blue Pill, ESP8266 NodeMCU, ZMPT101B, SCT-013-005, ST7735 TFT, ST-Link V2, batteries, AMS1117 regulators, passives, extension board, fuse).
- ✅ Two independent battery packs assembled (Pack A: 2× 18650 series + AMS1117 → 3.3 V for STM32, Pack B: 1× 18650 + AMS1117 → 3.3 V for ESP8266) with a common GND tie.
- ✅ Voltage sensor (ZMPT101B) wired to extension-board Line/Neutral; output verified on oscilloscope to be a clean ~3.3 V<sub>pp</sub> sinusoid biased around 1.65 V.
- ✅ Current sensor (SCT-013-005) burden resistor (33 Ω) confirmed; bias network built; clean isolated output observed.
- ✅ Safety: 2 A inline fuse on mains plug, no exposed mains conductors, sensors provide galvanic isolation.

### 7.2 Firmware (STM32 — `STM_Code/`)

- ✅ STM32CubeIDE project created with HAL drivers and CMSIS-DSP library linked.
- ✅ Dual-channel ADC1 with DMA and TIM3 trigger at 5 kS/s per channel; ping-pong buffer working without overruns.
- ✅ DC-offset removal and **RMS computation** on both channels — accuracy within ±1.5% of a Fluke 117 multimeter across 100–250 V<sub>rms</sub>.
- ✅ Zero-crossing **frequency detection** — stable at 49.9–50.1 Hz; matches reference within ±0.05 Hz.
- ✅ Instantaneous power × time-averaging → **real, apparent, reactive power, and power factor** computed and verified on a resistive bulb (PF ≈ 0.99) and inductive coil (PF ≈ 0.72).
- ✅ UART1 transmits a JSON line every 500 ms (`{"v":...,"i":...,"p":...,"pf":...,"f":...}`); confirmed on a USB-TTL bridge.

### 7.3 Calibration Results So Far

| Parameter | Reference (Fluke 117) | This System | Error |
|---|---|---|---|
| V<sub>rms</sub> @ 230 V | 231.4 V | 229.8 V | −0.69 % |
| V<sub>rms</sub> @ no-load | 232.0 V | 230.5 V | −0.65 % |
| I<sub>rms</sub> @ 60 W bulb | 0.262 A | 0.258 A | −1.53 % |
| I<sub>rms</sub> @ fan low | 0.187 A | 0.191 A | +2.14 % |
| Frequency | 49.98 Hz | 50.01 Hz | +0.06 % |
| P (60 W bulb) | 60.6 W | 59.3 W | −2.14 % |
| PF (bulb) | 0.99 | 0.99 | 0 |
| PF (inductive coil) | 0.73 | 0.72 | −1.37 % |

All RMS and power errors are within the ±2.5 % envelope informally targeted for this build.

---

## 8. Work Pending (Weeks 8–12)

| Week | Task | Status |
|---|---|---|
| 8 | TFT (ST7735) integration over SPI — 4-page UI: V/I/f/PF · P/S/Q · Harmonics · Waveform | Pending |
| 9 | CMSIS-DSP FFT integration → THD computation up to 10th harmonic | Pending |
| 10 | ESP8266 firmware — UART JSON receive + Async web server + Chart.js dashboard | Pending |
| 10 | Web dashboard — live tiles, historical line graphs, CSV export | Pending |
| 11 | Alert subsystem — buzzer, red/green LEDs, dashboard threshold highlighting | Pending |
| 11 | Multi-load demo testing (resistive / inductive / TRIAC-chopped / SMPS) | Pending |
| 12 | Final assembly on perfboard, optional enclosure, documentation, demo video | Pending |

**Estimated completion at this review: ~55%** (hardware build, acquisition pipeline, and all time-domain electrical parameters complete; display + DSP frequency-domain + IoT layer + alerts remain).

---

## 9. Challenges Encountered and Resolutions

1. **DC bias drift on SCT-013 output** — the 1.65 V mid-rail bias drifted by ~30 mV when the burden resistor heated up. Resolved by implementing a running-mean subtraction in firmware rather than relying on the resistor divider being perfect.
2. **ADC sampling jitter on overlapping conversions** — initial dual-channel scan mode with software trigger produced inconsistent inter-channel timing. Resolved by switching to TIM3 hardware-triggered DMA with regular-simultaneous mode.
3. **Floating-point cost of RMS in main loop** — initial naive implementation took ~12 ms per frame and missed the next DMA buffer-ready interrupt. Resolved by using `arm_rms_f32` from CMSIS-DSP, which uses NEON-equivalent ARMv7-M optimized inner loop — frame time dropped to ~2.4 ms.

---

## 10. Resources Used

- **IDE/Tools:** STM32CubeIDE 1.14, Arduino IDE 2.x, ST-Link V2, USB-TTL bridge, Fluke 117 DMM, DSO138 oscilloscope (lab).
- **Libraries:** STM32 HAL, CMSIS-DSP, (Chart.js + ESPAsyncWebServer planned for ESP side).
- **Bench:** ENTC PG lab — 230 V outlet, isolation transformer used during early bring-up.

---

## 11. References

1. ST Microelectronics, *STM32F103xx Reference Manual* (RM0008).
2. ARM, *CMSIS-DSP Software Library Documentation*, Rev. 1.10.
3. *IEEE Std 1159-2019 — Recommended Practice for Monitoring Electric Power Quality.*
4. ZMPT101B Datasheet, Nanjing Qiyue Electronic Technology.
5. YHDC SCT-013-005 Specification Sheet.
6. OpenEnergyMonitor Project — EmonLib RMS / real-power methodology (https://openenergymonitor.org).
7. Espressif Systems, *ESP8266 Non-OS SDK API Reference*.
8. Indian Electricity Rules, 1956 — Voltage and Frequency tolerance schedule.

---

*Mid-semester review submitted in fulfilment of the ESD course project requirement, Semester VI, ENTC, VIT Pune.*
