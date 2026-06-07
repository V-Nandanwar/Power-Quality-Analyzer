# Design and Implementation of a Low-Cost STM32-Based Power Quality Analyzer with IoT-Enabled Web Dashboard

---

## 1. Abstract

This project presents the design and implementation of a low-cost, portable power quality monitoring system built around the STM32F103C8T6 microcontroller. The system measures key power quality parameters — RMS voltage, RMS current, real power, apparent power, power factor, frequency, and harmonic distortion (THD) — in real-time from a standard 230V AC mains supply. An ESP8266 WiFi module transmits the acquired data to a web-based dashboard for remote monitoring, logging, and threshold-based alerts. The system is designed as an affordable alternative to commercial power quality analyzers that cost upwards of Rs.50,000.

---

## 2. Problem Statement

Power quality issues such as voltage sags, swells, frequency deviations, harmonics, and poor power factor are common in Indian electrical grids and industrial environments. These issues lead to equipment damage, energy wastage, and increased electricity costs. Commercial power quality analyzers (such as Fluke 435-II, Hioki PQ3198) are expensive and inaccessible for small-scale industries, workshops, and educational institutions. There is a need for a low-cost, IoT-enabled power quality monitoring solution that can be deployed widely.

---

## 3. Objectives

1. Measure RMS voltage, RMS current, frequency, real power, apparent power, reactive power, and power factor from 230V AC mains in real-time.
2. Perform FFT-based harmonic analysis to compute Total Harmonic Distortion (THD) up to the 10th harmonic.
3. Display all parameters on a local TFT/OLED screen.
4. Transmit data to a web dashboard via WiFi for remote monitoring and data logging.
5. Generate alerts when parameters exceed user-defined thresholds (voltage sag/swell, low power factor, high THD).
6. Validate measurement accuracy against a standard multimeter/oscilloscope.

---

## 4. System Architecture

```
    ┌──────────────────────────────────────────────────────────────┐
    │                    230V AC MAINS SUPPLY                      │
    │                      (Wall Socket)                           │
    │                           │                                  │
    │               ┌───────────┴───────────┐                      │
    │               │    Extension Board     │                      │
    │               │  (Load Connection Bus) │                      │
    │               └───────────┬───────────┘                      │
    │                           │                                  │
    │              Connected Test Loads:                            │
    │              • Incandescent bulb (resistive)                  │
    │              • Fan with regulator (harmonic generating)       │
    │              • Induction coil / motor (inductive)             │
    └──────────┬────────────────────────────────────┬──────────────┘
               │                                    │
         ┌─────┴──────┐                      ┌──────┴───────┐
         │  ZMPT101B   │                      │   SCT-013    │
         │  (Voltage   │                      │  (Current    │
         │   Sensor)   │                      │   Sensor)    │
         │             │                      │  Clamp-on    │
         │ 230V AC →   │                      │  around live │
         │ 0-3.3V out  │                      │  wire →      │
         └─────┬───────┘                      │  0-1V out    │
               │                              └──────┬───────┘
               │          Analog Signals             │
               │       (safe, isolated)              │
               └──────────────┬──────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │                    │
                    │   STM32F103C8T6    │
                    │   (Blue Pill)      │
                    │                    │
                    │  • Dual ADC + DMA  │
                    │  • RMS Calculation │
                    │  • FFT (THD)       │
                    │  • Power Calc      │
                    │  • Zero-crossing   │
                    │    frequency det.  │
                    │                    │
                    └──┬─────────────┬───┘
                       │             │
                       │ SPI         │ UART
                       │             │
              ┌────────┴───┐   ┌─────┴──────┐
              │ 1.8" TFT   │   │  ESP8266    │
              │ ST7735     │   │  NodeMCU    │
              │            │   │             │
              │ Live       │   │ Web Server  │
              │ display:   │   │ + Dashboard │
              │ • V, I, P  │   │             │
              │ • PF, THD  │   │ Accessible  │
              │ • Waveform │   │ from any    │
              │ • Alerts   │   │ browser on  │
              └────────────┘   │ same WiFi   │
                               └─────────────┘

    Power Supply for Electronics (Separate Battery Packs):

    PACK A (STM32):                    PACK B (ESP8266):
    2x 18650 series (7.4V)            1x 18650 (3.7V)
          │                                  │
     AMS1117 3.3V                       AMS1117 3.3V
          │                                  │
      STM32 3.3V                        ESP8266 3.3V
          │                                  │
          └──────── COMMON GND ──────────────┘
```

---

## 5. How It Works

### 5.1 Mains Connection (230V AC Wall Socket)

The system plugs into a standard 230V AC wall socket. An extension board serves as a load bus where different test loads can be plugged in and out during demonstrations. The user NEVER touches mains wiring — all connections are through standard plugs and sockets.

### 5.2 Voltage Sensing (ZMPT101B)

The ZMPT101B is a voltage transformer module. It connects across the mains (Line and Neutral) on its input side and outputs a proportional, galvanically isolated low-voltage AC signal (0 to ~3.3V peak-to-peak with DC bias) on its output side. This signal is safe for the STM32's ADC. The module provides electrical isolation between the dangerous mains voltage and the microcontroller circuit.

### 5.3 Current Sensing (SCT-013)

The SCT-013 is a split-core current transformer. It clamps around the live wire (no wire cutting needed) and outputs a proportional current/voltage signal. The SCT-013-005 variant (YHDC, 5A/1V) outputs 0-1V for 0-5A, which can be read directly by the STM32's ADC after biasing to mid-rail (1.65V DC offset). The 5A range provides better sensitivity for the low-current household loads used in this project (~0.5-1A). This sensor is completely non-contact and isolated.

### 5.4 Signal Conditioning

Both sensor outputs are biased to 1.65V (mid-rail of 3.3V) using a resistive voltage divider so that the full AC waveform (positive and negative halves) fits within the STM32's ADC range of 0-3.3V. Decoupling capacitors filter high-frequency noise.

### 5.5 ADC Sampling (STM32)

The STM32's two ADC channels sample voltage and current waveforms simultaneously using DMA (Direct Memory Access) triggered by a timer. Sampling rate: ~5000 samples/second per channel (100 samples per 50Hz cycle). DMA ensures zero CPU overhead during sampling.

### 5.6 Signal Processing

From the sampled data, the STM32 computes:

| Parameter | Method |
|---|---|
| **RMS Voltage** | Square root of mean of squared voltage samples over one full cycle |
| **RMS Current** | Square root of mean of squared current samples over one full cycle |
| **Frequency** | Zero-crossing detection — measure time between consecutive positive-going zero crossings |
| **Real Power (W)** | Average of instantaneous power (V[n] × I[n]) over one full cycle |
| **Apparent Power (VA)** | Vrms × Irms |
| **Reactive Power (VAR)** | √(Apparent² - Real²) |
| **Power Factor** | Real Power / Apparent Power |
| **THD (%)** | FFT on voltage waveform → ratio of harmonic content (2nd-10th) to fundamental (50Hz) |

### 5.7 FFT for Harmonic Analysis

A 256-point or 512-point FFT is performed on the sampled voltage waveform using the CMSIS-DSP library (optimized for ARM Cortex-M3). The FFT output gives the magnitude of each frequency component, allowing computation of individual harmonic amplitudes and Total Harmonic Distortion (THD).

### 5.8 Local Display (TFT)

A 1.8" TFT display (ST7735, 128x160, SPI interface) shows:
- Page 1: Voltage, Current, Frequency, Power Factor
- Page 2: Real Power, Apparent Power, Reactive Power
- Page 3: Harmonic bar chart (fundamental + harmonics 2-10) and THD %
- Page 4: Live voltage waveform (oscilloscope-style)

A push button cycles through the pages.

### 5.9 IoT Dashboard (ESP8266)

The STM32 sends computed parameters to the ESP8266 over UART. The ESP8266 runs a lightweight web server that serves an HTML/JavaScript dashboard. Any device (phone, laptop) on the same WiFi network can access the dashboard by navigating to the ESP8266's IP address in a browser.

Dashboard features:
- Live updating values (voltage, current, power, PF, THD, frequency)
- Historical graphs (voltage and current trends over time)
- Threshold alerts (highlighted in red when values go out of range)
- Data export (CSV download for logging)

### 5.10 Alerts

The system monitors for:
- Voltage sag (< 207V, i.e., -10% of 230V)
- Voltage swell (> 253V, i.e., +10% of 230V)
- Low power factor (< 0.85)
- High THD (> 8%)
- Frequency deviation (outside 49.5 - 50.5 Hz)

When a threshold is breached, the buzzer sounds, the red LED turns on, and the web dashboard highlights the parameter in red.

---

## 6. Demo Scenarios

| Action | What the Analyzer Shows |
|---|---|
| Nothing plugged into extension board (no load) | ~230V, ~0A, 50Hz, PF = N/A, THD low |
| Plug in an incandescent bulb (resistive load) | Current increases, PF ≈ 1.0, THD stays low |
| Plug in a fan with regulator at low speed | PF drops, THD increases significantly (chopped waveform from TRIAC) |
| Plug in an inductive load (coil/old motor) | PF drops to 0.6-0.8, reactive power appears |
| Multiple loads at once | Combined effect visible — real-world scenario |
| Mains voltage fluctuation (natural) | Voltage sag/swell detected, alert triggered |

---

## 7. Software Stack

| Component | Software/Tools |
|---|---|
| STM32 Programming | STM32CubeIDE (C language) |
| STM32 HAL/Libraries | STM32 HAL drivers + CMSIS-DSP (for FFT) |
| ESP8266 Programming | Arduino IDE (C/C++) |
| Web Dashboard | HTML + CSS + JavaScript (served from ESP8266 SPIFFS) |
| Communication Protocol | UART (STM32 → ESP8266), JSON formatted data |
| Charting Library | Chart.js (lightweight, runs in browser) |

---

## 8. Pin Connections

### STM32 Blue Pill Pinout

| STM32 Pin | Connected To | Purpose |
|---|---|---|
| PA0 | ZMPT101B output | ADC1 Channel 0 — Voltage sense |
| PA1 | SCT-013 output (via bias circuit) | ADC1 Channel 1 — Current sense |
| PA5 | TFT SCK | SPI1 Clock |
| PA7 | TFT SDA/MOSI | SPI1 Data |
| PB0 | TFT CS | Chip Select |
| PB1 | TFT DC/RS | Data/Command |
| PB10 | TFT RST | Reset |
| PA9 | ESP8266 RX | UART1 TX → ESP RX |
| PA10 | ESP8266 TX | UART1 RX ← ESP TX |
| PB12 | Buzzer | Alert output (GPIO) |
| PB13 | Red LED | Alert indicator |
| PB14 | Green LED | Normal/status indicator |
| PB15 | Push button | Page/mode switch (with pull-up) |
| 3.3V | Pack A AMS1117 output | Power input from STM32 battery pack |
| GND | Common ground (shared with ESP8266) | Ground |

### ESP8266 NodeMCU Pinout

| ESP8266 Pin | Connected To | Purpose |
|---|---|---|
| RX (GPIO3) | STM32 PA9 (TX) | Receive data from STM32 |
| TX (GPIO1) | STM32 PA10 (RX) | Transmit to STM32 (if needed) |
| 3.3V | Pack B AMS1117 output | Power input from ESP8266 battery pack |
| GND | Common ground (shared with STM32) | Ground |

---

## 9. Bill of Materials

### 9.1 Sensing Components

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 1 | ZMPT101B | AC voltage sensor module | 1 | Voltage sensing (230V → 0-3.3V) | 150 |
| 2 | SCT-013-005 (YHDC) | 5A / 1V output, clamp-on CT | 1 | Current sensing (non-contact) | 250 |
| 3 | 3.5mm audio jack | Female, PCB mount | 1 | SCT-013 connector | 10 |

### 9.2 Core Electronics

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 4 | STM32F103C8T6 | Blue Pill board | 1 | Main microcontroller | 500 |
| 5 | ESP8266 | NodeMCU v3 | 1 | WiFi module + web server | 250 |
| 6 | 1.8" TFT Display | ST7735, 128x160, SPI | 1 | Local display | 300 |
| 7 | ST-Link V2 | USB programmer | 1 | Flashing STM32 firmware | 200 |

### 9.3 Power Supply (for electronics — separate battery packs)

**Pack A — STM32 Power:**

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 8 | 18650 Li-ion battery | 3.7V, 1200mAh (already owned) | 2 | Power source (series = 7.4V) | 0 |
| 9 | 18650 battery holder | 2-slot, series wired | 1 | Battery mounting | 40 |
| 10 | AMS1117 3.3V module | SOT-223 on breakout board | 1 | Voltage regulation (7.4V → 3.3V) | 20 |
| 11 | Slide switch | SPST | 1 | Power ON/OFF for STM32 pack | 10 |

**Pack B — ESP8266 Power:**

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 12 | 18650 Li-ion battery | 3.7V, 1200mAh (already owned) | 1 | Power source (3.7V) | 0 |
| 13 | 18650 battery holder | 1-slot | 1 | Battery mounting | 25 |
| 14 | AMS1117 3.3V module | SOT-223 on breakout board | 1 | Voltage regulation (3.7V → 3.3V) | 20 |
| 15 | Slide switch | SPST | 1 | Power ON/OFF for ESP8266 pack | 10 |

> **IMPORTANT:** Both packs must share a common GND connection for UART communication between STM32 and ESP8266 to work. Total batteries used: 3 out of 5 available (2 spare).

### 9.4 Mains Interface

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 16 | 3-pin mains plug with 1m wire | Standard Indian plug, 6A | 1 | Mains input connection | 40 |
| 17 | Extension board / power strip | 3-4 sockets | 1 | Load bus for connecting test loads | 150 |
| 18 | 2A glass fuse + inline holder | 5x20mm | 1 | Overcurrent protection (safety) | 20 |

### 9.5 Test Loads (for demonstration)

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 19 | Incandescent bulb + holder | 40W / 60W, E27 screw base | 1 | Resistive load demo | 30 |
| 20 | Table fan with regulator | Any cheap one | 1 | Inductive + harmonic load | 0 (borrow) |
| 21 | Phone charger (cheap) | Any switching adapter | 1 | Non-linear load (harmonics) | 0 (already own) |

### 9.6 Passive Components

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 22 | 10kΩ resistors | 1/4W, ±5% | 4 | Voltage divider for ADC mid-point bias | 5 |
| 23 | 100kΩ resistors | 1/4W, ±5% | 2 | Voltage divider | 5 |
| 24 | 33Ω resistor | 1/4W, ±5% | 1 | Burden resistor for SCT-013 | 2 |
| 25 | 330Ω resistors | 1/4W, ±5% | 2 | LED current limiting | 2 |
| 26 | 10µF electrolytic capacitors | 25V | 3 | Power filtering | 5 |
| 27 | 100nF ceramic capacitors | 50V | 4 | Decoupling / noise filtering | 5 |

### 9.7 Prototyping and Wiring

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 28 | Breadboard | 830 tie-points | 1 | Circuit assembly | 100 |
| 29 | Jumper wires M-M | 40-piece pack | 1 | Breadboard connections | 40 |
| 30 | Jumper wires M-F | 40-piece pack | 1 | Sensor/display connections | 40 |
| 31 | Micro USB cable | Standard | 1 | Programming STM32/ESP | 50 |

### 9.8 Indicators and UI

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 32 | Active buzzer | 3.3V, through-hole | 1 | Audio alert on threshold breach | 20 |
| 33 | Red LED | 5mm, through-hole | 1 | Alert indicator | 3 |
| 34 | Green LED | 5mm, through-hole | 1 | Normal status indicator | 3 |
| 35 | Push button | 6x6mm tactile switch | 2 | Display page switching / mode | 5 |

### 9.9 Optional (for final version)

| # | Component | Specification | Qty | Purpose | Approx Cost (Rs.) |
|---|---|---|---|---|---|
| 36 | Perf board / stripboard | 7x9 cm | 1 | Soldered final version | 30 |
| 37 | Plastic enclosure / project box | ~15x10x5 cm | 1 | Housing the final unit | 80 |
| 38 | Standoffs + screws | M3, assorted | 1 set | Mounting boards in enclosure | 20 |

---

## 10. Cost Summary

| Category | Cost (Rs.) |
|---|---|
| Sensing components | ~410 |
| Core electronics (STM32, ESP, Display, Programmer) | ~1,250 |
| Power Pack A — STM32 (batteries free) | ~70 |
| Power Pack B — ESP8266 (battery free) | ~55 |
| Mains interface | ~210 |
| Test loads | ~30 (fan/charger borrowed) |
| Passive components | ~24 |
| Prototyping and wiring | ~230 |
| Indicators and UI | ~31 |
| **Total (must buy)** | **~Rs.2,310** |
| Optional (enclosure, perfboard) | ~130 |
| **Total (with optional)** | **~Rs.2,440** |

> **Note:** If your college lab provides breadboard, jumper wires, ST-Link programmer, and USB cable, the cost reduces to approximately **Rs.1,850**.

---

## 11. Safety Considerations

1. **Sensor isolation:** Both ZMPT101B and SCT-013 provide galvanic isolation between 230V mains and the low-voltage electronics. The STM32 circuit NEVER has direct electrical contact with mains voltage.
2. **Fuse protection:** A 2A fuse on the mains input protects against short circuits.
3. **No exposed mains wiring:** All mains connections use standard plugs, sockets, and the extension board. No bare wire connections.
4. **Battery powered electronics:** The STM32 and ESP8266 are powered by separate, independent battery packs, completely isolated from the mains. This eliminates any ground loop or leakage path risk. Both packs share a common ground for UART communication.
5. **Clamp-on current sensor:** The SCT-013 clamps around an insulated wire — there is no need to strip insulation or touch bare conductors.

**IMPORTANT:** The ZMPT101B module's input side connects to Line and Neutral of the mains. This connection should be made inside the extension board or behind a properly insulated junction. Never leave mains-voltage terminals exposed.

---

## 12. Implementation Timeline (Suggested)

| Week | Task |
|---|---|
| Week 1-2 | Component procurement, STM32CubeIDE setup, blink test, UART test |
| Week 3 | ADC + DMA setup, read ZMPT101B and SCT-013 raw values |
| Week 4 | Signal conditioning circuit, calibrate voltage and current readings against multimeter |
| Week 5 | Implement RMS calculation, frequency detection (zero-crossing) |
| Week 6 | Implement power calculations (real, apparent, reactive, PF) |
| Week 7 | Implement FFT using CMSIS-DSP, compute THD |
| Week 8 | TFT display integration — show all parameters |
| Week 9 | ESP8266 firmware — UART receive + web server + dashboard HTML |
| Week 10 | Alert system (buzzer, LED, web alerts), threshold configuration |
| Week 11 | Testing with different loads, calibration, accuracy validation |
| Week 12 | Final assembly, documentation, demo preparation |

---

## 13. References

1. STM32F103C8T6 Reference Manual — ST Microelectronics
2. CMSIS-DSP Library Documentation — ARM
3. ZMPT101B Datasheet and Application Notes
4. SCT-013 Current Transformer Specifications
5. ESP8266 Arduino Core Documentation
6. "Power Quality" — IEEE Standard 1159
7. Indian Electricity Rules — Voltage and frequency tolerance limits

---

*Document prepared for ESD Course Project — Semester 6*
