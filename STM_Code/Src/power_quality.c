/*
 * power_quality.c — see power_quality.h
 *
 * Pipeline (executed once per filled DMA buffer, ~80 ms):
 *   1. de-interleave V/I into float arrays, subtract DC mean
 *   2. apply calibration scale (counts → volts / amps)
 *   3. compute RMS of V, RMS of I
 *   4. compute real power = mean(v[n] * i[n])
 *   5. derive apparent power, reactive power, power factor
 *   6. estimate frequency from voltage zero crossings
 *   7. Goertzel for harmonics 1..10 of voltage → THD
 */

#include "power_quality.h"
#include <math.h>

#define N           ADC_BUFFER_SAMPLES
#define FS_HZ       ((float)ADC_SAMPLE_RATE_HZ)
#define FUND_HZ     50.0f
#define NUM_HARMS   10

static float v_buf[N];
static float i_buf[N];

/* Goertzel single-bin DFT magnitude.
 * Returns peak amplitude (so 1.0 → ±1.0 sinusoid). */
static float goertzel_mag(const float *x, int n, float fs, float freq)
{
    float omega = 2.0f * (float)M_PI * freq / fs;
    float coeff = 2.0f * cosf(omega);
    float q1 = 0.0f, q2 = 0.0f;
    for (int k = 0; k < n; k++) {
        float q0 = coeff * q1 - q2 + x[k];
        q2 = q1;
        q1 = q0;
    }
    float real = q1 - q2 * cosf(omega);
    float imag = q2 * sinf(omega);
    return (2.0f / (float)n) * sqrtf(real * real + imag * imag);
}

/* Linear-interpolated zero-crossing frequency estimate. Counts positive-going
 * zero crossings of the (already DC-removed) voltage buffer and uses the
 * fractional sample positions of the first and last crossings. */
static float estimate_frequency(const float *x, int n, float fs)
{
    int   count = 0;
    float first_frac = 0.0f, last_frac = 0.0f;
    int   have_first = 0;

    for (int k = 1; k < n; k++) {
        if (x[k - 1] < 0.0f && x[k] >= 0.0f) {
            float frac = (float)(k - 1) + (-x[k - 1]) / (x[k] - x[k - 1]);
            if (!have_first) { first_frac = frac; have_first = 1; }
            last_frac = frac;
            count++;
        }
    }

    if (count < 2) return 0.0f;
    float cycles  = (float)(count - 1);
    float samples = last_frac - first_frac;
    if (samples <= 0.0f) return 0.0f;
    return cycles * fs / samples;
}

void pq_process(const uint16_t *dma_buf, pq_metrics_t *out)
{
    /* 1. De-interleave + accumulate means */
    float v_mean = 0.0f, i_mean = 0.0f;
    for (int k = 0; k < (int)N; k++) {
        v_buf[k] = (float)dma_buf[2 * k];
        i_buf[k] = (float)dma_buf[2 * k + 1];
        v_mean += v_buf[k];
        i_mean += i_buf[k];
    }
    v_mean /= (float)N;
    i_mean /= (float)N;

    /* 2. Remove DC bias and apply calibration */
    for (int k = 0; k < (int)N; k++) {
        v_buf[k] = (v_buf[k] - v_mean) * VOLTAGE_CAL;
        i_buf[k] = (i_buf[k] - i_mean) * CURRENT_CAL;
    }

    /* 3-5. RMS, real power, derived */
    float sum_v2 = 0.0f, sum_i2 = 0.0f, sum_p = 0.0f;
    for (int k = 0; k < (int)N; k++) {
        sum_v2 += v_buf[k] * v_buf[k];
        sum_i2 += i_buf[k] * i_buf[k];
        sum_p  += v_buf[k] * i_buf[k];
    }
    out->v_rms          = sqrtf(sum_v2 / (float)N);
    out->i_rms          = sqrtf(sum_i2 / (float)N);
    /* 2-pin plug: orientation is non-deterministic, so the sign of P depends
     * on which way the user plugged it in. Take |P| — for residential loads
     * (no regenerative sources) real power is always positive anyway. */
    out->real_power     = fabsf(sum_p / (float)N);
    out->apparent_power = out->v_rms * out->i_rms;

    float reactive_sq = out->apparent_power * out->apparent_power
                      - out->real_power * out->real_power;
    out->reactive_power = (reactive_sq > 0.0f) ? sqrtf(reactive_sq) : 0.0f;
    /* PF is positive by construction now (P was made positive above). */
    out->power_factor   = (out->apparent_power > 0.001f)
                          ? (out->real_power / out->apparent_power) : 0.0f;
    if (out->power_factor > 1.0f) out->power_factor = 1.0f;

    /* 6. Frequency from zero crossings */
    out->frequency = estimate_frequency(v_buf, (int)N, FS_HZ);

    /* 7. Harmonics 1..10 of voltage by Goertzel */
    float fund = 0.0f, harm_sq_sum = 0.0f;
    for (int h = 0; h < NUM_HARMS; h++) {
        float f = FUND_HZ * (float)(h + 1);
        float m = goertzel_mag(v_buf, (int)N, FS_HZ, f);
        out->harmonics[h] = m;
        if (h == 0) fund = m;
        else harm_sq_sum += m * m;
    }
    out->thd_percent = (fund > 0.001f)
                       ? (sqrtf(harm_sq_sum) / fund) * 100.0f
                       : 0.0f;

    /* Alert flags. Suppress all alerts when there is no signal at all
     * (e.g., mains is unplugged or sensor disconnected) — otherwise the
     * buzzer would beep continuously during bring-up. We require Vrms > 5 V
     * to consider the reading "real". */
    out->alert_flags = 0;
    int signal_present = (out->v_rms > 5.0f);

    if (signal_present) {
        if (out->v_rms < V_SAG_THRESHOLD)                       out->alert_flags |= ALERT_V_SAG;
        if (out->v_rms > V_SWELL_THRESHOLD)                     out->alert_flags |= ALERT_V_SWELL;
        if (out->power_factor < PF_LOW_THRESHOLD &&
            out->apparent_power > 5.0f)                         out->alert_flags |= ALERT_PF_LOW;
        if (out->thd_percent > THD_HIGH_THRESHOLD)              out->alert_flags |= ALERT_THD_HIGH;
        if (out->frequency > 1.0f &&
            (out->frequency < FREQ_LOW_THRESHOLD ||
             out->frequency > FREQ_HIGH_THRESHOLD))             out->alert_flags |= ALERT_FREQ_DEV;
    }
}
