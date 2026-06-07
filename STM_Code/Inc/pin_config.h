/*
 * pin_config.h — Pin assignments for STM32F411CEU6 (WeAct Black Pill)
 *
 * Display has been removed from the project — all readings are streamed to
 * the ESP8266 over UART1 and the web dashboard is the only UI.
 *
 * Caveat: PA0 doubles as the K1 user button on the WeAct board. The button
 * is normally open (high-Z) so it doesn't disturb ADC readings, but pressing
 * it shorts PA0 to GND and will momentarily zero the voltage measurement.
 * Don't press K1 while logging.
 *
 * If you change a pin, update both this header and the .ioc CubeMX config.
 */
#ifndef PIN_CONFIG_H
#define PIN_CONFIG_H

#include "stm32f4xx_hal.h"

/* ------------------------------------------------------------------------- */
/* Analog inputs (sensors)                                                   */
/* ------------------------------------------------------------------------- */

/* ZMPT101B voltage sensor → PA0 (ADC1_IN0) */
#define VSENSE_GPIO_Port     GPIOA
#define VSENSE_Pin           GPIO_PIN_0
#define VSENSE_ADC_CHANNEL   ADC_CHANNEL_0

/* SCT-013 current sensor (via 33 ohm burden + 1.65V bias) → PA1 (ADC1_IN1) */
#define ISENSE_GPIO_Port     GPIOA
#define ISENSE_Pin           GPIO_PIN_1
#define ISENSE_ADC_CHANNEL   ADC_CHANNEL_1

/* ------------------------------------------------------------------------- */
/* UART1 → ESP8266 (NodeMCU)                                                  */
/* ------------------------------------------------------------------------- */
/* PA9  = USART1_TX → ESP8266 RX
 * PA10 = USART1_RX ← ESP8266 TX
 * Baud rate: 115200, 8N1.
 * Both modules MUST share a common GND.                                     */

/* ------------------------------------------------------------------------- */
/* Indicators                                                                 */
/* ------------------------------------------------------------------------- */

/* Active buzzer (HIGH = beep) → PB12 */
#define BUZZER_GPIO_Port     GPIOB
#define BUZZER_Pin           GPIO_PIN_12

/* Red LED (alert) → PB13 (HIGH = on, via 330 ohm resistor) */
#define LED_RED_GPIO_Port    GPIOB
#define LED_RED_Pin          GPIO_PIN_13

/* Green LED (normal/heartbeat) → PB14 (HIGH = on, via 330 ohm resistor) */
#define LED_GREEN_GPIO_Port  GPIOB
#define LED_GREEN_Pin        GPIO_PIN_14

/* Onboard "blue" LED on the WeAct Black Pill → PC13.
 * Active LOW: PC13 = 0 turns the LED on, PC13 = 1 turns it off.
 * Used as a 1 Hz heartbeat to prove the main loop is alive. */
#define LED_ONBOARD_GPIO_Port    GPIOC
#define LED_ONBOARD_Pin          GPIO_PIN_13
#define LED_ONBOARD_ON_LEVEL     GPIO_PIN_RESET
#define LED_ONBOARD_OFF_LEVEL    GPIO_PIN_SET

#endif /* PIN_CONFIG_H */
