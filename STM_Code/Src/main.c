/*
 * main.c — Power Quality Analyzer firmware (STM32F411CEU6, WeAct Black Pill)
 *
 * No local display: V/I sampled by ADC+DMA, processed into engineering units,
 * streamed as JSON over UART1 to the ESP8266. Buzzer + LEDs give a local
 * indication that an alert threshold tripped.
 *
 * Build (STM32CubeIDE / CubeMX setup):
 *   1. New STM32 project → MCU = STM32F411CEUx.
 *   2. RCC: HSE = Crystal/Ceramic Resonator (board has 25 MHz crystal).
 *   3. Clock Configuration tab:
 *        PLL Source Mux        = HSE
 *        PLLM                  = 25     (VCO input = 1 MHz)
 *        PLLN                  = 200    (VCO output = 200 MHz)
 *        PLLP                  = 2      (SYSCLK = 100 MHz)
 *        PLLQ                  = 4      (PLL48CLK = 50 MHz, USB unused)
 *        System Clock Mux      = PLLCLK
 *        AHB Prescaler         = /1     (HCLK = 100 MHz)
 *        APB1 Prescaler        = /2     (PCLK1 = 50 MHz, APB1 timer clk = 100 MHz)
 *        APB2 Prescaler        = /1     (PCLK2 = 100 MHz, APB2 timer clk = 100 MHz)
 *   4. ADC1:
 *        Mode = IN0 + IN1 enabled
 *        Clock Prescaler      = PCLK2 / 4   (ADC clock = 25 MHz, max 36)
 *        Resolution           = 12 bits
 *        Scan Conversion      = Enabled
 *        Continuous           = Disabled
 *        Discontinuous        = Disabled
 *        DMA Continuous Req.  = Enabled
 *        End of Conv          = EOC at end of single conversion
 *        External Trigger     = Timer 3 Trigger Out event
 *        Number of Conversions= 2
 *        Rank 1 = ADC_CHANNEL_0 (PA0), Sampling Time = 28 cycles
 *        Rank 2 = ADC_CHANNEL_1 (PA1), Sampling Time = 28 cycles
 *        DMA Settings: ADC1 → DMA2 Stream 0, Channel 0,
 *                      Circular, Half Word ↔ Half Word, Memory increment.
 *   5. TIM3:
 *        Clock Source         = Internal Clock
 *        Prescaler            = 124
 *        Counter Period (ARR) = 124          (100 MHz / 125 / 125 = 6400 Hz)
 *        Trigger Output       = Update Event
 *   6. USART1:
 *        Asynchronous, Baud = 115200, 8N1.   (PA9 = TX, PA10 = RX)
 *   7. GPIO outputs PB12 (buzzer), PB13 (red LED), PB14 (green LED).
 *      Optional: PC13 (onboard LED, active LOW) for heartbeat.
 *   8. NVIC: enable DMA2 stream0 global interrupt.
 *   9. Generate code → drop the contents of STM_Code/Inc and STM_Code/Src
 *      into Core/Inc and Core/Src (overwrite the auto-generated main.c,
 *      stm32f4xx_it.c, and stm32f4xx_hal_msp.c).
 *  10. Build → flash via ST-Link, or via the WeAct's USB-C in DFU mode
 *      (hold BOOT0, tap NRST).
 */

#include "main.h"
#include "pin_config.h"
#include "power_quality.h"

#include <stdio.h>
#include <string.h>

/* ------------------------------------------------------------------------- */
/* HAL handles                                                                */
/* ------------------------------------------------------------------------- */
ADC_HandleTypeDef  hadc1;
DMA_HandleTypeDef  hdma_adc1;
TIM_HandleTypeDef  htim3;
UART_HandleTypeDef huart1;

/* ------------------------------------------------------------------------- */
/* DMA buffer + double-buffer flag                                            */
/* ------------------------------------------------------------------------- */
static uint16_t adc_dma_buffer[ADC_DMA_BUFFER_LEN];
static volatile uint8_t  buffer_ready = 0;     /* 1 = first half, 2 = second half */
static volatile uint32_t process_count = 0;

static pq_metrics_t metrics;

/* ------------------------------------------------------------------------- */
/* Forward declarations                                                       */
/* ------------------------------------------------------------------------- */
static void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_ADC1_Init(void);
static void MX_TIM3_Init(void);
static void MX_USART1_UART_Init(void);

static void send_json_to_esp(const pq_metrics_t *m);
static void update_indicators(const pq_metrics_t *m);

/* ========================================================================= */
int main(void)
{
    HAL_Init();
    SystemClock_Config();

    MX_GPIO_Init();
    MX_DMA_Init();
    MX_ADC1_Init();
    MX_TIM3_Init();
    MX_USART1_UART_Init();

    /* Kick off DMA-driven ADC and start the trigger timer */
    HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_dma_buffer, ADC_DMA_BUFFER_LEN);
    HAL_TIM_Base_Start(&htim3);

    HAL_GPIO_WritePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin, GPIO_PIN_SET);

    uint32_t last_uart      = 0;
    uint32_t last_heartbeat = 0;

    while (1)
    {
        if (buffer_ready) {
            pq_process(adc_dma_buffer, &metrics);
            buffer_ready = 0;
            process_count++;
            update_indicators(&metrics);
        }

        uint32_t now = HAL_GetTick();
        if (now - last_uart >= 200) {          /* 5 Hz UART → ESP8266 */
            send_json_to_esp(&metrics);
            last_uart = now;
        }
        if (now - last_heartbeat >= 500) {     /* 1 Hz onboard LED blink */
            HAL_GPIO_TogglePin(LED_ONBOARD_GPIO_Port, LED_ONBOARD_Pin);
            last_heartbeat = now;
        }
    }
}

/* ------------------------------------------------------------------------- */
/* DMA callbacks                                                              */
/* ------------------------------------------------------------------------- */
void HAL_ADC_ConvHalfCpltCallback(ADC_HandleTypeDef *hadc)
{
    (void)hadc;
    buffer_ready = 1;
}

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
    (void)hadc;
    buffer_ready = 2;
}

/* ------------------------------------------------------------------------- */
/* Indicator outputs                                                          */
/* ------------------------------------------------------------------------- */
static void update_indicators(const pq_metrics_t *m)
{
    uint8_t alert          = m->alert_flags != 0;
    uint8_t signal_present = (m->v_rms > 5.0f);

    /* Red LED  = real alert active (sag/swell/PF/THD/freq).
     * Green LED = sensor is producing signal (mains present + ADC working).
     * Buzzer    = audible alert. */
    HAL_GPIO_WritePin(LED_RED_GPIO_Port,   LED_RED_Pin,
                      alert ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin,
                      signal_present ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(BUZZER_GPIO_Port,    BUZZER_Pin,
                      alert ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

/* ------------------------------------------------------------------------- */
/* JSON to ESP8266 over UART                                                  */
/* ------------------------------------------------------------------------- */
static void send_json_to_esp(const pq_metrics_t *m)
{
    char line[320];
    int n = snprintf(line, sizeof line,
        "{\"v\":%.1f,\"i\":%.3f,\"f\":%.2f,\"p\":%.1f,\"s\":%.1f,\"q\":%.1f,"
        "\"pf\":%.3f,\"thd\":%.2f,\"alert\":%u,"
        "\"h\":[%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f]}\n",
        m->v_rms, m->i_rms, m->frequency,
        m->real_power, m->apparent_power, m->reactive_power,
        m->power_factor, m->thd_percent,
        (unsigned)m->alert_flags,
        m->harmonics[0], m->harmonics[1], m->harmonics[2], m->harmonics[3],
        m->harmonics[4], m->harmonics[5], m->harmonics[6], m->harmonics[7],
        m->harmonics[8], m->harmonics[9]);
    if (n > 0) HAL_UART_Transmit(&huart1, (uint8_t *)line, (uint16_t)n, 100);
}

/* ========================================================================= */
/* System clock — 25 MHz HSE → 100 MHz SYSCLK                                 */
/* ========================================================================= */
static void SystemClock_Config(void)
{
    RCC_OscInitTypeDef osc = {0};
    RCC_ClkInitTypeDef clk = {0};

    /* The F4 needs the voltage scaling and flash latency set before bumping
     * the clock — Scale 2 + 3 wait states is the canonical config for 100 MHz */
    __HAL_RCC_PWR_CLK_ENABLE();
    __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE2);

    osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
    osc.HSEState       = RCC_HSE_ON;
    osc.PLL.PLLState   = RCC_PLL_ON;
    osc.PLL.PLLSource  = RCC_PLLSOURCE_HSE;
    osc.PLL.PLLM       = 25;     /* HSE / M = 25 MHz / 25 = 1 MHz VCO input  */
    osc.PLL.PLLN       = 200;    /* VCO = 1 × 200 = 200 MHz                  */
    osc.PLL.PLLP       = RCC_PLLP_DIV2;  /* SYSCLK = 200 / 2 = 100 MHz       */
    osc.PLL.PLLQ       = 4;      /* PLL48CLK = 200 / 4 = 50 MHz (USB unused) */
    if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();

    clk.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                       | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    clk.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
    clk.AHBCLKDivider  = RCC_SYSCLK_DIV1;     /* HCLK  = 100 MHz */
    clk.APB1CLKDivider = RCC_HCLK_DIV2;       /* PCLK1 = 50 MHz, TIM clk 100 */
    clk.APB2CLKDivider = RCC_HCLK_DIV1;       /* PCLK2 = 100 MHz, TIM clk 100 */
    if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_3) != HAL_OK) Error_Handler();
}

/* ========================================================================= */
/* GPIO init (LEDs + buzzer)                                                  */
/* ========================================================================= */
static void MX_GPIO_Init(void)
{
    GPIO_InitTypeDef g = {0};
    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();
    __HAL_RCC_GPIOC_CLK_ENABLE();

    HAL_GPIO_WritePin(BUZZER_GPIO_Port,    BUZZER_Pin,    GPIO_PIN_RESET);
    HAL_GPIO_WritePin(LED_RED_GPIO_Port,   LED_RED_Pin,   GPIO_PIN_RESET);
    HAL_GPIO_WritePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin, GPIO_PIN_RESET);

    g.Pin   = BUZZER_Pin | LED_RED_Pin | LED_GREEN_Pin;
    g.Mode  = GPIO_MODE_OUTPUT_PP;
    g.Pull  = GPIO_NOPULL;
    g.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(GPIOB, &g);

    /* Onboard "blue" LED on PC13 (active LOW). Heartbeat indicator. */
    HAL_GPIO_WritePin(LED_ONBOARD_GPIO_Port, LED_ONBOARD_Pin, LED_ONBOARD_OFF_LEVEL);
    g.Pin   = LED_ONBOARD_Pin;
    g.Mode  = GPIO_MODE_OUTPUT_PP;
    g.Pull  = GPIO_NOPULL;
    g.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(LED_ONBOARD_GPIO_Port, &g);
}

/* ========================================================================= */
/* DMA init — DMA2 Stream 0 for ADC1                                          */
/* ========================================================================= */
static void MX_DMA_Init(void)
{
    __HAL_RCC_DMA2_CLK_ENABLE();
    HAL_NVIC_SetPriority(DMA2_Stream0_IRQn, 0, 0);
    HAL_NVIC_EnableIRQ(DMA2_Stream0_IRQn);
}

/* ========================================================================= */
/* ADC1 — scan mode, 2 channels, TIM3 TRGO trigger                            */
/* ========================================================================= */
static void MX_ADC1_Init(void)
{
    ADC_ChannelConfTypeDef ch = {0};

    hadc1.Instance                   = ADC1;
    hadc1.Init.ClockPrescaler        = ADC_CLOCK_SYNC_PCLK_DIV4;  /* 25 MHz */
    hadc1.Init.Resolution            = ADC_RESOLUTION_12B;
    hadc1.Init.ScanConvMode          = ENABLE;
    hadc1.Init.ContinuousConvMode    = DISABLE;
    hadc1.Init.DiscontinuousConvMode = DISABLE;
    hadc1.Init.ExternalTrigConvEdge  = ADC_EXTERNALTRIGCONVEDGE_RISING;
    hadc1.Init.ExternalTrigConv      = ADC_EXTERNALTRIGCONV_T3_TRGO;
    hadc1.Init.DataAlign             = ADC_DATAALIGN_RIGHT;
    hadc1.Init.NbrOfConversion       = 2;
    hadc1.Init.DMAContinuousRequests = ENABLE;
    hadc1.Init.EOCSelection          = ADC_EOC_SINGLE_CONV;
    if (HAL_ADC_Init(&hadc1) != HAL_OK) Error_Handler();

    ch.Channel      = VSENSE_ADC_CHANNEL;
    ch.Rank         = 1;
    ch.SamplingTime = ADC_SAMPLETIME_28CYCLES;
    if (HAL_ADC_ConfigChannel(&hadc1, &ch) != HAL_OK) Error_Handler();

    ch.Channel      = ISENSE_ADC_CHANNEL;
    ch.Rank         = 2;
    if (HAL_ADC_ConfigChannel(&hadc1, &ch) != HAL_OK) Error_Handler();
}

/* ========================================================================= */
/* TIM3 — 6400 Hz update event drives ADC trigger                             */
/* ========================================================================= */
static void MX_TIM3_Init(void)
{
    TIM_MasterConfigTypeDef mc = {0};
    TIM_ClockConfigTypeDef  cc = {0};

    htim3.Instance               = TIM3;
    htim3.Init.Prescaler         = 124;       /* 100 MHz / 125 = 800 kHz */
    htim3.Init.CounterMode       = TIM_COUNTERMODE_UP;
    htim3.Init.Period            = 124;       /* 800 kHz / 125 = 6400 Hz */
    htim3.Init.ClockDivision     = TIM_CLOCKDIVISION_DIV1;
    htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
    if (HAL_TIM_Base_Init(&htim3) != HAL_OK) Error_Handler();

    cc.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
    if (HAL_TIM_ConfigClockSource(&htim3, &cc) != HAL_OK) Error_Handler();

    mc.MasterOutputTrigger = TIM_TRGO_UPDATE;
    mc.MasterSlaveMode     = TIM_MASTERSLAVEMODE_DISABLE;
    if (HAL_TIMEx_MasterConfigSynchronization(&htim3, &mc) != HAL_OK) Error_Handler();
}

/* ========================================================================= */
/* USART1 — 115200 8N1                                                        */
/* ========================================================================= */
static void MX_USART1_UART_Init(void)
{
    huart1.Instance        = USART1;
    huart1.Init.BaudRate   = 115200;
    huart1.Init.WordLength = UART_WORDLENGTH_8B;
    huart1.Init.StopBits   = UART_STOPBITS_1;
    huart1.Init.Parity     = UART_PARITY_NONE;
    huart1.Init.Mode       = UART_MODE_TX_RX;
    huart1.Init.HwFlowCtl  = UART_HWCONTROL_NONE;
    huart1.Init.OverSampling = UART_OVERSAMPLING_16;
    if (HAL_UART_Init(&huart1) != HAL_OK) Error_Handler();
}

void Error_Handler(void)
{
    __disable_irq();
    HAL_GPIO_WritePin(LED_RED_GPIO_Port, LED_RED_Pin, GPIO_PIN_SET);
    while (1) { }
}

#ifdef USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line) { (void)file; (void)line; }
#endif
