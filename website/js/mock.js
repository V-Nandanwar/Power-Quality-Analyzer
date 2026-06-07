// Mock data source. Emits the same JSON shape the ESP8266 produces, so the
// dashboard sees no difference between this and real hardware.
//
// MockSource is a *factory* — call MockSource.create(scenarioName) to get a
// new independent stream. The home page spins one up per simulated machine;
// the dashboard spins one up for the selected machine.
//
// Packet shape (also the contract for ESP8266 /data endpoint):
//   {
//     ts:        epoch ms,
//     v_rms:     volts,
//     i_rms:     amps,
//     freq:      Hz,
//     pf:        0..1,
//     p_real:    W,
//     p_app:     VA,
//     p_reac:    VAR,
//     thd:       %,
//     harmonics: [10 values — % of fundamental, index 0 is fundamental (100)],
//     waveform:  [128 voltage samples over one cycle, centered on 0],
//   }

const MockSource = (() => {

  const SCENARIOS = {
    no_load: {
      v: 231, i: 0.02, pf: 0.30, thd: 1.5, freq: 50.00,
      harmonics: [100, 1.0, 0.5, 0.3, 0.2, 0.1, 0.1, 0.05, 0.05, 0.03],
    },
    resistive: {
      v: 230, i: 0.26, pf: 0.99, thd: 1.8, freq: 50.00,
      harmonics: [100, 1.2, 0.6, 0.3, 0.2, 0.15, 0.1, 0.08, 0.06, 0.04],
    },
    inductive: {
      v: 229, i: 1.20, pf: 0.72, thd: 3.5, freq: 49.98,
      harmonics: [100, 2.5, 1.5, 0.8, 0.5, 0.3, 0.2, 0.15, 0.1, 0.08],
    },
    harmonic: {
      v: 228, i: 0.80, pf: 0.65, thd: 18.0, freq: 49.97,
      harmonics: [100, 3.0, 15.0, 2.0, 10.0, 1.5, 6.0, 1.0, 3.0, 0.8],
    },
    mixed: {
      v: 227, i: 2.10, pf: 0.82, thd: 8.5, freq: 49.95,
      harmonics: [100, 3.0, 7.0, 2.0, 4.0, 1.2, 2.0, 0.8, 1.0, 0.5],
    },
    sag: {
      v: 198, i: 1.00, pf: 0.85, thd: 3.0, freq: 49.60,
      harmonics: [100, 2.0, 1.2, 0.6, 0.4, 0.2, 0.15, 0.1, 0.08, 0.06],
    },
    swell: {
      v: 258, i: 1.10, pf: 0.88, thd: 2.8, freq: 50.25,
      harmonics: [100, 2.2, 1.3, 0.7, 0.4, 0.2, 0.15, 0.1, 0.08, 0.06],
    },
    frequency_drift: {
      v: 230, i: 0.80, pf: 0.92, thd: 2.5, freq: 48.80,
      harmonics: [100, 2.0, 1.0, 0.5, 0.3, 0.2, 0.15, 0.1, 0.08, 0.06],
    },
  };

  function noise(scale) { return (Math.random() - 0.5) * 2 * scale; }
  function gauss(sigma) {
    const u = Math.random() || 1e-9;
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
  }

  function generateWaveform(vPeak, harmonicsPct, phase) {
    const N = 128;
    const out = new Array(N);
    for (let n = 0; n < N; n++) {
      let sum = 0;
      for (let h = 0; h < harmonicsPct.length; h++) {
        const amp = vPeak * (harmonicsPct[h] / 100);
        sum += amp * Math.sin(2 * Math.PI * (h + 1) * n / N + phase + h * 0.13);
      }
      out[n] = sum + gauss(vPeak * 0.005);
    }
    return out;
  }

  // Factory: returns a brand-new MockSource instance with its own scenario,
  // timer, and subscriber list. Multiple instances run independently.
  function create(initialScenario) {
    let currentScenario = SCENARIOS[initialScenario] ? initialScenario : 'resistive';
    let phase = 0;
    let timerId = null;
    const subscribers = new Set();

    function emit() {
      const s = SCENARIOS[currentScenario] || SCENARIOS.resistive;

      const v_rms = Math.max(0, s.v + gauss(0.5));
      const i_rms = Math.max(0, s.i + gauss(s.i * 0.02 + 0.002));
      const freq  = s.freq + gauss(0.02);
      const pf    = Math.max(0, Math.min(1, s.pf + gauss(0.005)));
      const thd   = Math.max(0, s.thd + gauss(0.15));

      const p_app  = v_rms * i_rms;
      const p_real = p_app * pf;
      const p_reac = p_app * Math.sqrt(Math.max(0, 1 - pf * pf));

      const vPeak = v_rms * Math.SQRT2;
      phase += 0.15;
      const waveform = generateWaveform(vPeak, s.harmonics, phase);

      const harmonics = s.harmonics.map((h, idx) =>
        idx === 0 ? 100 : Math.max(0, h + noise(0.1))
      );

      const packet = {
        ts: Date.now(),
        v_rms, i_rms, freq, pf,
        p_real, p_app, p_reac, thd,
        harmonics, waveform,
      };

      subscribers.forEach(cb => {
        try { cb(packet); } catch (e) { console.error(e); }
      });
    }

    function start() {
      if (timerId) return;
      timerId = setInterval(emit, CONFIG.MOCK_INTERVAL_MS);
    }

    function stop() {
      if (timerId) { clearInterval(timerId); timerId = null; }
    }

    function subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }

    function setScenario(name) {
      if (SCENARIOS[name]) currentScenario = name;
    }

    function getScenario() { return currentScenario; }

    return { start, stop, subscribe, setScenario, getScenario, mode: 'mock' };
  }

  return { create, SCENARIOS };
})();
