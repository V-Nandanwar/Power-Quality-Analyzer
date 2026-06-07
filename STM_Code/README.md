# STM32 Firmware — Build & Flash Manual

Power Quality Analyzer firmware for the **WeAct STM32F411CEU6 Black Pill** (USB-C). Reads voltage from a ZMPT101B and current from an SCT-013-005, computes RMS / power / frequency / THD, and streams JSON over UART to an ESP8266 every 200 ms.

---

## At a glance

| Item | Value |
|---|---|
| Target MCU | STM32F411CEU6 (Cortex-M4F, 100 MHz, 128 KB Flash, 128 KB RAM) |
| Board | WeAct Black Pill v3.x |
| HSE crystal | 25 MHz (on-board) |
| ADC sample rate | 6400 Hz per channel |
| FFT method | Goertzel (10 harmonics) |
| Output protocol | UART1 → ESP8266, 115200 8N1, JSON line @ 5 Hz |
| Toolchain | STM32CubeIDE (free) |

---

## 1. Hardware checklist

Before you start, have these on hand:

- WeAct STM32F411CEU6 Black Pill, soldered to a breadboard
- ZMPT101B voltage sensor module wired as in the project doc
- SCT-013-005 current clamp + bias circuit (10 kΩ + 10 kΩ divider, SCT BLACK to midpoint, RED to PA1)
- ESP8266 NodeMCU (for receiving UART data — separate firmware in `ESP_Code/`)
- 2× 18650 batteries in series + AMS1117 3.3 V module → STM32 power
- 1× 18650 + AMS1117 → ESP8266 power
- LEDs (red, green) + 330 Ω resistors, active 3.3 V buzzer
- **One of:**
  - ST-Link V2 dongle (cheap clone is fine)
  - or just a USB-C cable (we can flash via DFU mode)

**Quick wiring check:** Multimeter → DC volts → STM32 3V3 to GND should read ~3.3 V before you proceed. ZMPT OUT to GND should read ~1.65 V (the module's onboard bias).

---

## 2. Software prerequisites

1. **STM32CubeIDE** — download from <https://www.st.com/en/development-tools/stm32cubeide.html> (free, requires ST account). Install with defaults.
2. **ST-Link USB driver** — included with CubeIDE. If Windows doesn't recognise the ST-Link, install **STSW-LINK009** from ST's website.
3. **(Optional) STM32CubeProgrammer** — only needed if you want to flash via DFU mode over USB-C without an ST-Link.

---

## 3. Create the CubeIDE project

1. Launch CubeIDE. When asked to pick a workspace, choose any folder — e.g. `C:\STM32Workspace`.
2. **File → New → STM32 Project**.
3. In the **MCU/MPU Selector** tab, type `STM32F411CEU` in the search box, select **STM32F411CEUx** from the right-hand list, click **Next**.
4. Project settings:

   | Field | Value |
   |---|---|
   | Project Name | `PowerQualityAnalyzer` |
   | Targeted Language | C |
   | Targeted Project Type | STM32Cube |

5. Click **Finish**. When asked "Initialize all peripherals with their default mode?" → **No** (we configure only what we need).
6. The `.ioc` file opens automatically. You should see a chip diagram on the right.

---

## 4. Configure RCC (the crystal oscillator)

1. Left panel: **System Core → RCC**.
2. **High Speed Clock (HSE)** dropdown → **Crystal/Ceramic Resonator**.
3. PD0 and PD1 in the chip diagram should turn green with `RCC_OSC_IN` / `RCC_OSC_OUT`.

---

## 5. Configure SWD (debug interface)

1. Left panel: **System Core → SYS**.
2. **Debug** dropdown → **Serial Wire**.
3. PA13 (SWDIO) and PA14 (SWCLK) turn green. These pins go to the ST-Link.

---

## 6. Configure the system clock (100 MHz)

1. Click the **Clock Configuration** tab at the top of the .ioc editor.
2. Set these dropdowns / fields in the clock-tree diagram:

   | Block | Setting |
   |---|---|
   | PLL Source Mux | **HSE** |
   | PLLM | **25** |
   | PLLN | **200** |
   | PLLP | **/2** |
   | PLLQ | **4** |
   | System Clock Mux | **PLLCLK** |
   | AHB Prescaler | **/1** |
   | APB1 Prescaler | **/2** |
   | APB2 Prescaler | **/1** |

3. Verify the result on the right side of the diagram:

   | Clock | Expected |
   |---|---|
   | HCLK (MHz) | **100** |
   | APB1 peripheral clocks | 50 |
   | APB1 timer clocks | **100** |
   | APB2 peripheral clocks | **100** |
   | APB2 timer clocks | 100 |

   If anything boxes in red, fix it before continuing.

---

## 7. Assign the pins

Switch back to the **Pinout & Configuration** tab. For each row in the table:

1. **Left-click** the pin on the chip diagram (or use the search box at the top of the diagram).
2. Pick the function from the popup menu.
3. **Right-click** the pin → **Enter User Label** → type the label → press Enter.

| # | Pin | Function | User Label | Connected to |
|---|---|---|---|---|
| 1 | **PA0** | `ADC1_IN0` | `VSENSE` | ZMPT101B **OUT** |
| 2 | **PA1** | `ADC1_IN1` | `ISENSE` | SCT-013 bias-divider midpoint (where the BLACK SCT wire is — and the SCT RED wire goes here too via the burden) |
| 3 | **PA9** | `USART1_TX` | (auto) | ESP8266 RX (GPIO3) |
| 4 | **PA10** | `USART1_RX` | (auto) | ESP8266 TX (GPIO1) |
| 5 | **PB12** | `GPIO_Output` | `BUZZER` | Active 3.3 V buzzer (+) |
| 6 | **PB13** | `GPIO_Output` | `LED_RED` | Red LED anode → 330 Ω → GND |
| 7 | **PB14** | `GPIO_Output` | `LED_GREEN` | Green LED anode → 330 Ω → GND |

> ⚠ **Important — User Labels must match exactly** (`VSENSE`, `ISENSE`, `BUZZER`, `LED_RED`, `LED_GREEN`). The firmware's `pin_config.h` macros map to these names.

> ⚠ **WeAct K1 button caveat:** PA0 is also wired to the on-board K1 user button. The button is normally open / high-impedance, so it doesn't disturb ADC readings. **Just don't press K1 while the analyzer is running** — it will short the ZMPT signal to GND for as long as it's pressed.

After this step, the chip diagram should show:

```
PA0  green  VSENSE
PA1  green  ISENSE
PA9  green  USART1_TX
PA10 green  USART1_RX
PA13 green  SYS_JTMS-SWDIO
PA14 green  SYS_JTCK-SWCLK
PB12 green  BUZZER
PB13 green  LED_RED
PB14 green  LED_GREEN
PD0  green  RCC_OSC_IN
PD1  green  RCC_OSC_OUT
```

---

## 8. Configure the GPIO output settings

1. Left panel: **System Core → GPIO**.
2. The list shows PB12, PB13, PB14. Click each in turn and set:

   | Field | Value |
   |---|---|
   | GPIO output level | Low |
   | GPIO mode | Output Push Pull |
   | GPIO Pull-up/Pull-down | No pull-up and no pull-down |
   | Maximum output speed | Low |

(PA0/PA1/PA9/PA10/PA13/PA14 don't need anything in this panel — analog and AF pins handle their own settings.)

---

## 9. Configure ADC1

1. Left panel: **Analog → ADC1**.
2. **IN0** and **IN1** checkboxes should already be ticked.
3. **Configuration → Parameter Settings** (bottom pane):

   | Field | Value |
   |---|---|
   | Clock Prescaler | **PCLK2 divided by 4** |
   | Resolution | 12 bits |
   | Data Alignment | Right alignment |
   | Scan Conversion Mode | **Enabled** |
   | Continuous Conversion Mode | Disabled |
   | Discontinuous Conversion Mode | Disabled |
   | DMA Continuous Requests | **Enabled** |
   | End Of Conversion Selection | EOC flag at the end of single channel conversion |
   | Number Of Conversion | **2** |
   | External Trigger Conversion Source | **Timer 3 Trigger Out event** |
   | External Trigger Conversion Edge | Trigger detection on the rising edge |
   | Rank 1 → Channel | Channel 0 |
   | Rank 1 → Sampling Time | **28 Cycles** |
   | Rank 2 → Channel | Channel 1 |
   | Rank 2 → Sampling Time | **28 Cycles** |

4. **Configuration → DMA Settings tab → Add**:

   | Field | Value |
   |---|---|
   | DMA Request | ADC1 |
   | Stream | **DMA2 Stream 0** |
   | Direction | Peripheral To Memory |
   | Priority | High |
   | Mode | **Circular** |
   | Increment Address | tick **Memory** only |
   | Data Width — Peripheral | Half Word |
   | Data Width — Memory | Half Word |
   | Use FIFO | unchecked |

5. **Configuration → NVIC Settings tab**:

   | Interrupt | Enabled |
   |---|---|
   | DMA2 stream0 global interrupt | ✓ |

---

## 10. Configure TIM3 (the ADC trigger)

1. Left panel: **Timers → TIM3**.
2. **Clock Source** → **Internal Clock**.
3. **Configuration → Parameter Settings**:

   | Field | Value |
   |---|---|
   | Prescaler | **124** |
   | Counter Mode | Up |
   | Counter Period (AutoReload Register) | **124** |
   | Internal Clock Division (CKD) | No Division |
   | auto-reload preload | Disable |
   | Trigger Output (TRGO) → Master/Slave Mode | Disable (Reset) |
   | Trigger Output (TRGO) → Trigger Event Selection | **Update Event** |

4. **Do not** enable the TIM3 interrupt — we use TRGO only.

> **Why these numbers?** 100 MHz / (124+1) / (124+1) = **6400 Hz** ADC trigger rate.

---

## 11. Configure USART1

1. Left panel: **Connectivity → USART1**.
2. **Mode** → **Asynchronous**.
3. PA9 / PA10 should already be assigned (from Step 7).
4. **Configuration → Parameter Settings**:

   | Field | Value |
   |---|---|
   | Baud Rate | **115200** Bits/s |
   | Word Length | 8 Bits (including Parity) |
   | Parity | None |
   | Stop Bits | 1 |
   | Data Direction | Receive and Transmit |
   | Over Sampling | 16 Samples |

5. NVIC settings: **don't enable** the USART1 interrupt (we use blocking transmit).

---

## 12. Generate the code

1. Save the .ioc with **Ctrl+S**.
2. When prompted "Do you want to generate Code?" → **Yes**.
3. When asked to switch to the C/C++ perspective → **Yes**.
4. The Project Explorer (left side) now shows `Core/Inc/`, `Core/Src/`, `Drivers/`, etc.

---

## 13. Drop in the firmware files

In a file explorer, navigate to `STM_Code/`. Copy the following files into your CubeIDE project, **overwriting** when prompted:

| Source file | Destination |
|---|---|
| `STM_Code/Inc/pin_config.h` | `Core/Inc/pin_config.h` (new) |
| `STM_Code/Inc/main.h` | `Core/Inc/main.h` (overwrite) |
| `STM_Code/Inc/power_quality.h` | `Core/Inc/power_quality.h` (new) |
| `STM_Code/Src/main.c` | `Core/Src/main.c` (overwrite) |
| `STM_Code/Src/power_quality.c` | `Core/Src/power_quality.c` (new) |
| `STM_Code/Src/stm32f4xx_it.c` | `Core/Src/stm32f4xx_it.c` (overwrite) |
| `STM_Code/Src/stm32f4xx_hal_msp.c` | `Core/Src/stm32f4xx_hal_msp.c` (overwrite) |

After copying, in CubeIDE: right-click the project root in Project Explorer → **Refresh** (`F5`).

---

## 14. Add the math library to the linker

The DSP code uses `sinf`, `cosf`, `sqrtf`, `fabsf` — these are in `libm`.

1. Right-click the project → **Properties**.
2. Navigate: **C/C++ Build → Settings → Tool Settings → MCU GCC Linker → Libraries**.
3. Under **Libraries (-l)**, click the green **+** button.
4. Type `m` (just the letter m), click **OK**.
5. Click **Apply and Close**.

---

## 15. Build

1. **Project → Build All** (`Ctrl+B`).
2. Watch the Console at the bottom. A clean build ends with:

   ```
   text   data    bss    dec    hex filename
   12340     8   2236  14584   38f8 PowerQualityAnalyzer.elf
   Finished building target: PowerQualityAnalyzer.elf
   ```

3. If you see errors, jump to **Troubleshooting** at the bottom of this README.

---

## 16. Flash the firmware

You have two options. Pick the one matching what hardware you have.

### Option A — ST-Link V2 (recommended, fastest)

Wire the ST-Link to the Black Pill SWD pads on the back of the board:

| ST-Link V2 pin | Black Pill pad |
|---|---|
| 3.3V | 3V3 |
| GND | GND |
| SWDIO | DIO (= PA13) |
| SWCLK | CLK (= PA14) |

Plug the ST-Link into your PC. In CubeIDE:

1. Click the **bug** icon ▾ → **Debug As → STM32 Cortex-M C/C++ Application** (first time only — sets up a debug config).
2. Or for plain flashing without debug, click **Run** ▾ → **Run As → STM32 Cortex-M C/C++ Application**.
3. CubeIDE programs the flash and resets the chip. Green LED on PB14 should turn on within a second.

### Option B — DFU mode over USB-C (no ST-Link needed)

1. Connect the Black Pill to your PC via USB-C.
2. **Hold the BOOT0 button**, then **tap the NRST button**, then **release BOOT0**. The chip is now in the DFU bootloader.
3. Open **STM32CubeProgrammer**.
4. Set the connection method to **USB**, click **Connect** (it should detect a "DFU device").
5. **Open file** → navigate to `<your project>/Debug/PowerQualityAnalyzer.elf` (or `.bin`/`.hex`).
6. Click **Download**.
7. Tap NRST again to leave DFU mode and run the firmware.

---

## 17. Verify it works

After a successful flash:

1. **Green LED on PB14** is on solid → main loop is running.
2. With a **multimeter on PA9** to GND in DC volts mode, you should see ~3.3 V idle with brief dips when JSON is being transmitted (every 200 ms).
3. Even better — connect a USB-TTL adapter to PA9 (and GND), open a serial monitor at **115200 8N1**, and you should see lines like:

   ```
   {"v":230.5,"i":0.26,"f":50.0,"p":59.5,"s":59.9,"q":4.5,"pf":0.99,"thd":1.8,"alert":0,"h":[230.0,...]}
   ```

   The numbers will be wrong without calibration — that's normal.

---

## 18. Calibrate VOLTAGE_CAL and CURRENT_CAL

Edit `Core/Inc/main.h` (lines ~28-34):

```c
#define VOLTAGE_CAL          0.383f
#define CURRENT_CAL          0.0087f
```

### Voltage calibration

1. Plug into mains, no load.
2. Read mains Vrms with a multimeter (call this `V_actual`, e.g. 232.5 V).
3. Read what the dashboard shows for Vrms (call this `V_displayed`).
4. New `VOLTAGE_CAL` = `old VOLTAGE_CAL × (V_actual / V_displayed)`.
5. Update the value in main.h, rebuild, reflash.

### Current calibration

1. Plug in a known load — a 60 W incandescent bulb is perfect (60 W ÷ 230 V ≈ 0.261 A).
2. Read what the dashboard shows for Irms.
3. New `CURRENT_CAL` = `old CURRENT_CAL × (0.261 / I_displayed)`.
4. Update, rebuild, reflash.

After calibration the dashboard should read within ±2 % of the multimeter for both V and I, and the derived quantities (P, S, Q, PF, THD) follow automatically.

---

## File structure reference

```
STM_Code/
├── README.md           ← this file
├── Inc/
│   ├── pin_config.h    ← pin macros (must match CubeMX User Labels)
│   ├── main.h          ← sampling parameters + calibration constants
│   └── power_quality.h ← DSP function signatures
└── Src/
    ├── main.c          ← app loop, peripheral init, UART JSON output
    ├── power_quality.c ← RMS, power, frequency, Goertzel harmonics, THD
    ├── stm32f4xx_it.c  ← interrupt service routines (DMA dispatch)
    └── stm32f4xx_hal_msp.c ← peripheral pin/clock/DMA wiring
```

| File | What it controls | Edit if you want to |
|---|---|---|
| `pin_config.h` | Pin assignments | Move a sensor or LED to a different GPIO |
| `main.h` | Sample rate, calibration, alert thresholds | Calibrate, change alert limits |
| `power_quality.h` | DSP API | (rarely) |
| `main.c` | Boot sequence, main loop, UART format | Change UART rate, change JSON fields |
| `power_quality.c` | All math (RMS, P/Q/S, freq, THD) | Improve accuracy, add more harmonics |
| `stm32f4xx_it.c` | ISR dispatch | (rarely) |
| `stm32f4xx_hal_msp.c` | DMA + GPIO AF setup | Change DMA stream, alternate function |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Build error "redefinition of `MX_..._Init`" | The auto-generated `main.c` wasn't overwritten by ours | Delete the auto-generated `Core/Src/main.c` and recopy ours |
| Build error "undefined reference to `sinf`" | `libm` not linked | Step 14 — add `m` to linker libraries |
| Build error "stm32f1xx_hal.h: No such file" | A copy slipped in from the F1 version | Re-copy all files from `STM_Code/` (they should all reference `stm32f4xx_hal.h`) |
| Build error "unknown type name `ADC_HandleTypeDef`" | Missing `#include "main.h"` | Should already be included; re-check that `main.h` has `#include "stm32f4xx_hal.h"` |
| Flash fails, "ST-Link not found" | USB driver missing | Install **STSW-LINK009** from ST's website |
| Flash fails, "Target not detected" | SWDIO/SWCLK swapped | Double-check ST-Link wiring (table in Step 16) |
| Green LED doesn't light after flash | Firmware not running | Press the NRST button on the Black Pill to reset |
| LED is on but no JSON on PA9 | TIM3 / ADC / DMA misconfigured | Re-check Steps 9–10. Most common: forgot to enable DMA2 Stream 0 NVIC interrupt |
| JSON appears but all values are zero | Sensors not powered, or PA0/PA1 reading 0 V instead of 1.65 V | Multimeter check on PA0 and PA1; should both read ~1.65 V DC |
| Vrms / Irms readings way off | Need calibration | Step 18 |
| ADC readings noisy | Loose breadboard wire on the bias node | Wiggle wires; consider adding the 100 nF + 10 µF caps on the bias node |
| ESP8266 doesn't receive anything | Forgot common GND between Pack A and Pack B | Add a wire between the two AMS1117 GND pins |
| Pressing K1 button on Black Pill makes V reading drop to 0 | Expected — K1 shorts PA0 to GND | Don't press K1 during operation |

---

## Pin reference for hardware wiring (quick lookup)

| Signal | Black Pill pin | Connects to |
|---|---|---|
| Voltage sense (analog in) | **PA0** | ZMPT101B **OUT** |
| Current sense (analog in) | **PA1** | SCT bias divider midpoint |
| UART TX → ESP | **PA9** | ESP8266 GPIO3 (RX) |
| UART RX ← ESP | **PA10** | ESP8266 GPIO1 (TX) |
| Buzzer | **PB12** | Active 3.3 V buzzer (+) |
| Red LED | **PB13** | LED anode → 330 Ω → GND |
| Green LED | **PB14** | LED anode → 330 Ω → GND |
| Power | **3V3** | Pack A AMS1117 VOUT |
| Ground | **GND** | Common GND rail (shared with ESP) |
| SWD data (programming) | **PA13 / DIO** | ST-Link SWDIO |
| SWD clock (programming) | **PA14 / CLK** | ST-Link SWCLK |
