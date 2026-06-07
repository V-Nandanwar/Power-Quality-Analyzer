// Wires datasource -> DOM, charts, alerts, CSV export, threshold form.

(function () {

  // -------- which machine are we showing? ----------
  const params    = new URLSearchParams(window.location.search);
  const machineId = params.get('id');
  const machine   = (typeof getMachineById === 'function')
                      ? getMachineById(machineId)
                      : null;
  if (!machine) {
    document.body.innerHTML =
      `<div style="font-family:monospace;color:#fff;background:#111;padding:40px;min-height:100vh">
         <h1>Unknown machine</h1>
         <p>No machine matched <code>?id=${machineId || '(none)'}</code> in <code>js/machines.js</code>.</p>
         <p><a href="index.html" style="color:#7af">&larr; Back to fleet</a></p>
       </div>`;
    return;
  }
  document.title = `${machine.id.toUpperCase()} — ${machine.name}`;

  function setText(id, text) {
    const e = document.getElementById(id);
    if (e) e.textContent = text;
  }
  setText('nameplate-suffix',  machine.id.replace(/^pqa-/, ''));
  setText('nameplate-title',   machine.name);
  setText('nameplate-location', machine.location || '—');
  setText('nameplate-serial',   machine.serial   || '—');
  setText('nameplate-fw',       machine.fw       || '—');

  // -------- state --------
  let thresholds = Alerts.load();
  let history = [];          // rolling CSV buffer
  let paused = false;

  const sessionStart = Date.now();
  let pktCount = 0;
  const rateWindow = [];       // timestamps of last N packets for rate calc

  const PARAMS = ['v_rms', 'i_rms', 'freq', 'pf', 'p_real', 'p_app', 'p_reac', 'thd'];
  const FORMAT = {
    v_rms:  v => v.toFixed(1),
    i_rms:  v => (v * 1000).toFixed(0),
    freq:   v => v.toFixed(2),
    pf:     v => v.toFixed(3),
    p_real: v => v.toFixed(1),
    p_app:  v => v.toFixed(1),
    p_reac: v => v.toFixed(1),
    thd:    v => v.toFixed(1),
  };

  // min/max/avg tracking
  const stats = {};
  function resetStats() {
    PARAMS.forEach(p => stats[p] = { min: Infinity, max: -Infinity, sum: 0, count: 0 });
  }
  resetStats();

  // -------- DOM refs --------
  const el = {
    kpi: Object.fromEntries(PARAMS.map(p => {
      const card = document.querySelector(`.kpi-card[data-param="${p}"]`);
      return [p, {
        card,
        value:  card.querySelector('[data-role="value"]'),
        limits: card.querySelector('[data-role="limits"]'),
        min:    card.querySelector('[data-role="min"]'),
        max:    card.querySelector('[data-role="max"]'),
        avg:    card.querySelector('[data-role="avg"]'),
      }];
    })),
    lastUpdate:   document.getElementById('last-update'),
    connStatus:   document.getElementById('conn-status'),
    ledMode:      document.getElementById('led-mode'),
    modeText:     document.getElementById('mode-text'),
    ledLink:      document.getElementById('led-link'),
    simBadge:     document.getElementById('sim-badge'),
    alertConsole: document.getElementById('alert-console'),
    consoleTitle: document.getElementById('console-title'),
    alertsList:   document.getElementById('alerts-list'),
    alertsCount:  document.getElementById('alerts-count'),
    bufferCount:  document.getElementById('buffer-count'),
    pktCount:     document.getElementById('pkt-count'),
    pktRate:      document.getElementById('pkt-rate'),
    uptime:       document.getElementById('uptime'),
    scenario:     document.getElementById('scenario'),
    pauseBtn:     document.getElementById('pause-btn'),
    resetBtn:     document.getElementById('reset-stats'),
    exportBtn:    document.getElementById('export-csv'),
    // threshold form
    tForm:        document.getElementById('threshold-form'),
    tVsag:        document.getElementById('t-vsag'),
    tVswell:      document.getElementById('t-vswell'),
    tPfmin:       document.getElementById('t-pfmin'),
    tThdmax:      document.getElementById('t-thdmax'),
    tFmin:        document.getElementById('t-fmin'),
    tFmax:        document.getElementById('t-fmax'),
    tReset:       document.getElementById('t-reset'),
    tStatus:      document.getElementById('threshold-status'),
  };

  // -------- charts --------
  const trendChart    = Charts.setupTrendChart(document.getElementById('chart-trend'));
  const powerChart    = Charts.setupPowerChart(document.getElementById('chart-power'));
  const harmonicChart = Charts.setupHarmonicChart(document.getElementById('chart-harmonics'));
  const waveformChart = Charts.setupWaveformChart(document.getElementById('chart-waveform'));

  const TREND_MAX_POINTS = CONFIG.TREND_VISIBLE_POINTS;

  // -------- helpers --------
  function setConnState(state, text) {
    el.connStatus.dataset.state = state;
    el.connStatus.querySelector('.text').textContent = text;
  }

  function fmtTs(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' +
           String(d.getMilliseconds()).padStart(3, '0');
  }

  function fmtUptime(ms) {
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  let lastIrms = 0;

  function renderKPI(param, v) {
    const k = el.kpi[param];
    const s = stats[param];

    if (param === 'pf' && lastIrms < thresholds.i_min_for_pf) {
      k.value.textContent = '—';
      k.min.textContent = '—';
      k.max.textContent = '—';
      k.avg.textContent = '—';
      return;
    }

    s.sum += v;
    s.count += 1;
    if (v < s.min) s.min = v;
    if (v > s.max) s.max = v;

    const fmt = FORMAT[param];
    k.value.textContent = fmt(v);
    k.min.textContent = fmt(s.min);
    k.max.textContent = fmt(s.max);
    k.avg.textContent = fmt(s.sum / s.count);
  }

  function renderLimits(t) {
    const set = (p, label, value) => {
      el.kpi[p].limits.innerHTML = value
        ? `<em>${label}</em><b>${value}</b>`
        : '';
    };
    set('v_rms', 'LIMITS', `${t.v_sag} – ${t.v_swell} V`);
    set('freq',  'LIMITS', `${t.freq_min} – ${t.freq_max} Hz`);
    set('pf',    'LIMIT',  `≥ ${t.pf_min}`);
    set('thd',   'LIMIT',  `≤ ${t.thd_max} %`);
    // i_rms, p_real, p_app, p_reac have no thresholds — leave empty
    set('i_rms',  null, null);
    set('p_real', null, null);
    set('p_app',  null, null);
    set('p_reac', null, null);
  }

  function clearBreaches() {
    PARAMS.forEach(p => el.kpi[p].card.classList.remove('breach'));
  }

  function applyBreaches(alerts) {
    alerts.forEach(a => el.kpi[a.param]?.card.classList.add('breach'));
  }

  function renderAlerts(alerts) {
    const console = el.alertConsole;

    if (alerts.length === 0) {
      console.dataset.state = 'nominal';
      el.consoleTitle.textContent = 'ALL NOMINAL';
      el.alertsCount.textContent = '0';
      el.alertsList.innerHTML = '';
      return;
    }

    const hasCrit = alerts.some(a => a.severity === 'crit');
    console.dataset.state = hasCrit ? 'crit' : 'warn';
    el.consoleTitle.textContent = hasCrit ? 'CRITICAL' : 'WARNING';
    el.alertsCount.textContent = alerts.length;

    el.alertsList.innerHTML = alerts.map(a => `
      <div class="alert-item ${a.severity}">
        <strong>${a.label}</strong>
        <span class="alert-value">${a.value}</span>
        <span class="alert-limit">limit ${a.limit}</span>
      </div>
    `).join('');
  }

  function pushHistory(packet) {
    history.push(packet);
    if (history.length > CONFIG.HISTORY_MAX) history.shift();
    el.bufferCount.textContent = history.length;
  }

  function updateRate(ts) {
    rateWindow.push(ts);
    const cutoff = ts - 1000;
    while (rateWindow.length > 0 && rateWindow[0] < cutoff) rateWindow.shift();
    el.pktRate.textContent = rateWindow.length.toFixed(1);
  }

  // -------- main packet handler --------
  function onPacket(packet, err) {
    if (err) {
      setConnState('error', 'ERROR');
      el.ledLink.dataset.state = 'warn';
      return;
    }
    if (!packet || paused) return;

    setConnState('live', 'LIVE');
    el.ledLink.dataset.state = 'ok';
    el.lastUpdate.textContent = fmtTs(packet.ts);

    pktCount += 1;
    el.pktCount.textContent = pktCount;
    updateRate(packet.ts);

    lastIrms = packet.i_rms;
    const alerts = Alerts.check(packet, thresholds);

    clearBreaches();
    PARAMS.forEach(p => renderKPI(p, packet[p]));
    applyBreaches(alerts);
    renderAlerts(alerts);
    pushHistory(packet);

    const tsLabel = new Date(packet.ts).toLocaleTimeString('en-GB', { hour12: false });
    Charts.pushTrend(trendChart, tsLabel, packet.v_rms, packet.i_rms * 1000, TREND_MAX_POINTS);
    Charts.pushPower(powerChart, tsLabel, packet.p_real, packet.p_app, packet.p_reac, TREND_MAX_POINTS);
    Charts.updateHarmonics(harmonicChart, packet.harmonics);
    Charts.updateWaveform(waveformChart, packet.waveform);
  }

  // -------- CSV export --------
  function exportCSV() {
    if (history.length === 0) { alert('No data captured yet.'); return; }
    const headers = [
      'timestamp_iso','v_rms','i_rms_ma','freq','pf',
      'p_real_w','p_app_va','p_reac_var','thd_pct',
      'h1','h2','h3','h4','h5','h6','h7','h8','h9','h10',
    ];
    const rows = [headers.join(',')];
    for (const p of history) {
      rows.push([
        new Date(p.ts).toISOString(),
        p.v_rms.toFixed(3),
        (p.i_rms * 1000).toFixed(1),
        p.freq.toFixed(3),
        p.pf.toFixed(4),
        p.p_real.toFixed(2),
        p.p_app.toFixed(2),
        p.p_reac.toFixed(2),
        p.thd.toFixed(3),
        ...p.harmonics.map(h => h.toFixed(2)),
      ].join(','));
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pqa-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // -------- threshold form --------
  function fillThresholdForm(t) {
    el.tVsag.value   = t.v_sag;
    el.tVswell.value = t.v_swell;
    el.tPfmin.value  = t.pf_min;
    el.tThdmax.value = t.thd_max;
    el.tFmin.value   = t.freq_min;
    el.tFmax.value   = t.freq_max;
  }

  function readThresholdForm() {
    return {
      ...thresholds,
      v_sag:    parseFloat(el.tVsag.value),
      v_swell:  parseFloat(el.tVswell.value),
      pf_min:   parseFloat(el.tPfmin.value),
      thd_max:  parseFloat(el.tThdmax.value),
      freq_min: parseFloat(el.tFmin.value),
      freq_max: parseFloat(el.tFmax.value),
    };
  }

  function flashStatus(text, isError) {
    el.tStatus.textContent = text;
    el.tStatus.style.color = isError ? 'var(--crit)' : 'var(--ok)';
    el.tStatus.classList.add('show');
    setTimeout(() => el.tStatus.classList.remove('show'), 1800);
  }

  el.tForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = readThresholdForm();
    if (next.v_sag >= next.v_swell)       { flashStatus('V sag must be < V swell', true); return; }
    if (next.freq_min >= next.freq_max)   { flashStatus('Freq min must be < max', true); return; }
    if (next.pf_min < 0 || next.pf_min > 1) { flashStatus('PF must be 0–1', true); return; }
    thresholds = next;
    Alerts.save(thresholds);
    renderLimits(thresholds);
    flashStatus('Saved.');
  });

  el.tReset.addEventListener('click', () => {
    thresholds = Alerts.reset();
    fillThresholdForm(thresholds);
    renderLimits(thresholds);
    flashStatus('Reset to defaults.');
  });

  // -------- controls --------
  // The scenario dropdown is only meaningful for mock machines; show it then.
  const scenarioGroup = document.getElementById('scenario-group');
  if (machine.source === 'mock' && scenarioGroup) {
    scenarioGroup.hidden = false;
    if (machine.mockScenario) el.scenario.value = machine.mockScenario;
  }
  el.scenario.addEventListener('change', (e) => {
    if (source.setScenario) source.setScenario(e.target.value);
    resetStats();
    Alerts.resetBuffers();  // don't carry averages across scenarios
  });

  el.pauseBtn.addEventListener('click', () => {
    paused = !paused;
    el.pauseBtn.textContent = paused ? 'Resume' : 'Hold';
    if (paused) setConnState('paused', 'HOLD');
    else setConnState('live', 'LIVE');
  });

  el.resetBtn.addEventListener('click', () => {
    resetStats();
    PARAMS.forEach(p => {
      el.kpi[p].min.textContent = '—';
      el.kpi[p].max.textContent = '—';
      el.kpi[p].avg.textContent = '—';
    });
  });

  el.exportBtn.addEventListener('click', exportCSV);

  // -------- uptime tick --------
  function tickClock() {
    el.uptime.textContent = fmtUptime(Date.now() - sessionStart);
  }
  setInterval(tickClock, 1000);
  tickClock();

  // -------- mode LED + sim badge --------
  function setupModeIndicators() {
    const mode = source.mode || machine.source;
    if (mode === 'mock') {
      el.ledMode.dataset.state = 'sim';
      el.modeText.textContent = 'SIM';
      el.simBadge.style.display = 'inline-block';
    } else {
      el.ledMode.dataset.state = 'live';
      el.modeText.textContent = mode.toUpperCase();
      el.simBadge.style.display = 'none';
    }
  }

  // -------- boot --------
  const source = DataSource.forMachine(machine);
  fillThresholdForm(thresholds);
  renderLimits(thresholds);
  setupModeIndicators();
  if (machine.source === 'mock' && el.scenario && source.setScenario) {
    source.setScenario(el.scenario.value);
  }
  setConnState('connecting', 'CONNECTING');
  source.subscribe(onPacket);
  source.start();

})();
