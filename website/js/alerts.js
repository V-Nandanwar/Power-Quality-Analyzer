// Threshold checker. Runs on every packet and returns a list of active alerts.
// Duplicated on the MCU side (hard real-time buzzer/LED); this one drives UI.
//
// Two layers of noise rejection:
//   1. Moving average over CONFIG.ALERT_AVG_WINDOW_MS    (smooths raw noise)
//   2. Hysteresis — once an alert trips it doesn't clear  (kills residual flipping
//      until the signal crosses PAST the threshold by the  when averaged value
//      hysteresis gap                                      sits on the trip line)

const Alerts = (() => {

  const buffers = {
    v_rms: [], i_rms: [], pf: [], thd: [], freq: [],
  };
  const WINDOW_SIZE = Math.max(1, Math.round(
    CONFIG.ALERT_AVG_WINDOW_MS / CONFIG.MOCK_INTERVAL_MS
  ));

  // Active-alert state (hysteresis memory). Once an alert trips, it stays
  // tripped until the signal crosses the reset line.
  const state = {
    v_sag: false,
    v_swell: false,
    pf_low: false,
    thd_high: false,
    freq_dev: false,
  };

  function pushAndAvg(key, value) {
    const buf = buffers[key];
    buf.push(value);
    while (buf.length > WINDOW_SIZE) buf.shift();
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    return sum / buf.length;
  }

  function resetBuffers() {
    Object.keys(buffers).forEach(k => { buffers[k].length = 0; });
    Object.keys(state).forEach(k => { state[k] = false; });
  }

  function check(packet, thresholds) {
    const vAvg   = pushAndAvg('v_rms', packet.v_rms);
    const iAvg   = pushAndAvg('i_rms', packet.i_rms);
    const pfAvg  = pushAndAvg('pf',    packet.pf);
    const thdAvg = pushAndAvg('thd',   packet.thd);
    const fAvg   = pushAndAvg('freq',  packet.freq);

    const H = CONFIG.HYSTERESIS;

    // Voltage sag: trip below v_sag, clear once back above v_sag + H
    if (state.v_sag) {
      if (vAvg > thresholds.v_sag + H.v) state.v_sag = false;
    } else {
      if (vAvg < thresholds.v_sag) state.v_sag = true;
    }

    // Voltage swell: trip above v_swell, clear once back below v_swell - H
    if (state.v_swell) {
      if (vAvg < thresholds.v_swell - H.v) state.v_swell = false;
    } else {
      if (vAvg > thresholds.v_swell) state.v_swell = true;
    }

    // Low power factor: only meaningful when real current is flowing.
    // Trip when pf < pf_min. Clear when pf exceeds pf_min + H, OR when
    // current drops below the i_min floor (PF becomes meaningless).
    const currentAboveFloor = iAvg >= thresholds.i_min_for_pf;
    if (state.pf_low) {
      if (!currentAboveFloor || pfAvg > thresholds.pf_min + H.pf) state.pf_low = false;
    } else {
      if (currentAboveFloor && pfAvg < thresholds.pf_min) state.pf_low = true;
    }

    // High THD
    if (state.thd_high) {
      if (thdAvg < thresholds.thd_max - H.thd) state.thd_high = false;
    } else {
      if (thdAvg > thresholds.thd_max) state.thd_high = true;
    }

    // Frequency deviation (two-sided, treated as one alert).
    // Clears only when clearly inside the band (past both edges by H).
    if (state.freq_dev) {
      if (fAvg > thresholds.freq_min + H.freq && fAvg < thresholds.freq_max - H.freq) {
        state.freq_dev = false;
      }
    } else {
      if (fAvg < thresholds.freq_min || fAvg > thresholds.freq_max) {
        state.freq_dev = true;
      }
    }

    const alerts = [];
    if (state.v_sag) {
      alerts.push({
        param: 'v_rms', severity: 'crit', key: 'sag',
        label: 'Voltage sag',
        value: `${vAvg.toFixed(1)} V`,
        limit: `< ${thresholds.v_sag} V`,
      });
    }
    if (state.v_swell) {
      alerts.push({
        param: 'v_rms', severity: 'crit', key: 'swell',
        label: 'Voltage swell',
        value: `${vAvg.toFixed(1)} V`,
        limit: `> ${thresholds.v_swell} V`,
      });
    }
    if (state.pf_low) {
      alerts.push({
        param: 'pf', severity: 'warn', key: 'pf_low',
        label: 'Low power factor',
        value: pfAvg.toFixed(3),
        limit: `< ${thresholds.pf_min}`,
      });
    }
    if (state.thd_high) {
      alerts.push({
        param: 'thd', severity: 'warn', key: 'thd_high',
        label: 'High THD',
        value: `${thdAvg.toFixed(1)} %`,
        limit: `> ${thresholds.thd_max} %`,
      });
    }
    if (state.freq_dev) {
      alerts.push({
        param: 'freq', severity: 'crit', key: 'freq_dev',
        label: 'Frequency deviation',
        value: `${fAvg.toFixed(2)} Hz`,
        limit: `${thresholds.freq_min}–${thresholds.freq_max} Hz`,
      });
    }

    return alerts;
  }

  function load() {
    try {
      const raw = localStorage.getItem('pqa_thresholds');
      if (raw) return { ...CONFIG.DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...CONFIG.DEFAULT_THRESHOLDS };
  }

  function save(thresholds) {
    localStorage.setItem('pqa_thresholds', JSON.stringify(thresholds));
  }

  function reset() {
    localStorage.removeItem('pqa_thresholds');
    return { ...CONFIG.DEFAULT_THRESHOLDS };
  }

  return { check, load, save, reset, resetBuffers };
})();
