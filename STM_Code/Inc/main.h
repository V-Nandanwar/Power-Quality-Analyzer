/*
 * main.h — Public declarations + sampling parameters
 */
#ifndef MAIN_H
#define MAIN_H

#include "stm32f4xx_hal.h"

/* Sampling parameters
 * Fs = 6400 Hz, N = 512 → bin width = 12.5 Hz, 50 Hz fundamental at bin 4.
 * Buffer covers 80 ms = 4 mains cycles, so RMS / power averages are smooth.
 */
#define ADC_SAMPLE_RATE_HZ   6400U
#define ADC_BUFFER_SAMPLES   512U                  /* per channel             */
#define ADC_DMA_BUFFER_LEN   (ADC_BUFFER_SAMPLES * 2U) /* V,I interleaved     */

/* Calibration constants — adjust against a multimeter during bring-up.
 *
 * VOLTAGE_CAL: 230 V_rms / measured raw RMS (ADC counts after DC removal)
 *   Typical ZMPT101B with onboard pot tuned for ~1V peak swing on a 230V mains
 *   gives ~600 ADC counts RMS → cal ≈ 0.383
 *
 * CURRENT_CAL: SCT-013-005 outputs 1V for 5A → 5A / measured raw RMS
 *   With 33 ohm burden and 1.65V bias on 12-bit ADC, 1Arms gives ~115 counts
 *   → cal ≈ 0.0087
 */
#define VOLTAGE_CAL          0.561f
#define CURRENT_CAL          0.0087f

/* Alert thresholds (Section 5.10) */
#define V_SAG_THRESHOLD      207.0f
#define V_SWELL_THRESHOLD    253.0f
#define PF_LOW_THRESHOLD     0.85f
#define THD_HIGH_THRESHOLD   8.0f
#define FREQ_LOW_THRESHOLD   49.5f
#define FREQ_HIGH_THRESHOLD  50.5f

/* Computed measurements shared between processing and UART tasks */
typedef struct {
    float v_rms;
    float i_rms;
    float frequency;
    float real_power;       /* W   */
    float apparent_power;   /* VA  */
    float reactive_power;   /* VAR */
    float power_factor;
    float thd_percent;
    float harmonics[10];    /* index 0 = fundamental, 1..9 = 2nd..10th       */
    uint8_t alert_flags;    /* bitfield, see ALERT_* below                   */
} pq_metrics_t;

#define ALERT_V_SAG    (1U << 0)
#define ALERT_V_SWELL  (1U << 1)
#define ALERT_PF_LOW   (1U << 2)
#define ALERT_THD_HIGH (1U << 3)
#define ALERT_FREQ_DEV (1U << 4)

void Error_Handler(void);

#endif /* MAIN_H */
