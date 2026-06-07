/*
 * power_quality.h — RMS, power, frequency and harmonic analysis
 *
 * Operates on a buffer of ADC_BUFFER_SAMPLES voltage samples and
 * ADC_BUFFER_SAMPLES current samples. The DC bias (~1.65 V on a 0-3.3 V rail)
 * is removed by subtracting the buffer mean before any other calculation.
 *
 * Harmonic extraction uses the Goertzel algorithm at exactly 50, 100, 150, ...
 * 500 Hz so we don't need a windowed FFT and don't need CMSIS-DSP. With Fs =
 * 6400 Hz and N = 512, every harmonic up to the 10th lands on an integer bin
 * so spectral leakage is negligible.
 */
#ifndef POWER_QUALITY_H
#define POWER_QUALITY_H

#include "main.h"

/* Convert one V/I sample pair buffer (raw 12-bit ADC counts, interleaved as
 * the DMA delivered them) into engineering units.
 *
 * dma_buf      : pointer to ADC_DMA_BUFFER_LEN uint16_t, layout {V0,I0,V1,I1...}
 * out          : populated with all metrics
 *
 * Calibration constants (VOLTAGE_CAL, CURRENT_CAL) are applied here.            */
void pq_process(const uint16_t *dma_buf, pq_metrics_t *out);

#endif /* POWER_QUALITY_H */
