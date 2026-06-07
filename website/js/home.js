// Home page — renders one card per registered machine, subscribes each to a
// lightweight stream so the cards show live values, and routes clicks into
// dashboard.html?id=<machine_id>.

(function () {

  const grid          = document.getElementById('machine-grid');
  const fleetCount    = document.getElementById('fleet-count');
  const fleetOnline   = document.getElementById('fleet-online');
  const fleetAlerts   = document.getElementById('fleet-alerts');
  const fleetUptime   = document.getElementById('fleet-uptime');
  const sessionStart  = Date.now();

  // Per-machine state for the home page (NOT persisted across navigation).
  const machineState  = new Map();   // id → { source, lastPacket, lastRxAt, alerts }
  const thresholds    = loadThresholds();

  function loadThresholds() {
    try {
      const raw = localStorage.getItem('pqa_thresholds');
      if (raw) return { ...CONFIG.DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...CONFIG.DEFAULT_THRESHOLDS };
  }

  function buildCard(machine) {
    const card = document.createElement('a');
    card.className = 'machine-card';
    card.href = `dashboard.html?id=${encodeURIComponent(machine.id)}`;
    card.dataset.id = machine.id;
    card.dataset.state = 'connecting';

    card.innerHTML = `
      <div class="machine-head">
        <div class="machine-id">
          <span class="logo-mono">PQA</span>
          <span class="logo-sub">${escapeHtml(machine.id.replace(/^pqa-/, ''))}</span>
        </div>
        <span class="machine-pill" data-role="pill">
          <span class="pill-dot"></span>
          <span class="pill-text">…</span>
        </span>
      </div>
      <h2 class="machine-name">${escapeHtml(machine.name)}</h2>
      <div class="machine-loc">${escapeHtml(machine.location || '')}</div>

      <div class="machine-kpis">
        <div class="m-kpi" data-role="kpi-v">
          <em>V<sub>rms</sub></em>
          <b data-role="value">—</b>
          <span class="m-unit">V</span>
        </div>
        <div class="m-kpi" data-role="kpi-i">
          <em>I<sub>rms</sub></em>
          <b data-role="value">—</b>
          <span class="m-unit">mA</span>
        </div>
        <div class="m-kpi" data-role="kpi-p">
          <em>P</em>
          <b data-role="value">—</b>
          <span class="m-unit">W</span>
        </div>
        <div class="m-kpi" data-role="kpi-pf">
          <em>PF</em>
          <b data-role="value">—</b>
          <span class="m-unit">cosφ</span>
        </div>
      </div>

      <div class="machine-foot">
        <span class="machine-tag">${machine.source.toUpperCase()}</span>
        <span class="machine-alerts" data-role="alerts">All nominal</span>
      </div>
    `;

    return card;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmt(v, digits) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toFixed(digits);
  }

  function checkBreaches(packet) {
    const t = thresholds;
    const breaches = [];
    if (packet.v_rms < t.v_sag)                          breaches.push({ kind: 'crit', label: 'Sag' });
    if (packet.v_rms > t.v_swell)                        breaches.push({ kind: 'crit', label: 'Swell' });
    if (packet.i_rms >= t.i_min_for_pf &&
        packet.pf < t.pf_min)                            breaches.push({ kind: 'warn', label: 'Low PF' });
    if (packet.thd > t.thd_max)                          breaches.push({ kind: 'warn', label: 'High THD' });
    if (packet.freq < t.freq_min ||
        packet.freq > t.freq_max)                        breaches.push({ kind: 'crit', label: 'Freq dev.' });
    return breaches;
  }

  function renderCard(card, packet, breaches) {
    card.querySelector('[data-role="kpi-v"]  [data-role="value"]').textContent = fmt(packet.v_rms,  1);
    card.querySelector('[data-role="kpi-i"]  [data-role="value"]').textContent = fmt(packet.i_rms * 1000, 0);
    card.querySelector('[data-role="kpi-p"]  [data-role="value"]').textContent = fmt(packet.p_real, 1);
    card.querySelector('[data-role="kpi-pf"] [data-role="value"]').textContent =
      packet.i_rms < thresholds.i_min_for_pf ? '—' : fmt(packet.pf, 3);

    const alertsEl = card.querySelector('[data-role="alerts"]');
    if (breaches.length === 0) {
      alertsEl.textContent = 'All nominal';
      alertsEl.classList.remove('warn', 'crit');
    } else {
      alertsEl.classList.toggle('crit', breaches.some(b => b.kind === 'crit'));
      alertsEl.classList.toggle('warn', !breaches.some(b => b.kind === 'crit'));
      alertsEl.textContent = breaches.map(b => b.label).join(' · ');
    }

    const pillText = card.querySelector('[data-role="pill"] .pill-text');
    const hasCrit  = breaches.some(b => b.kind === 'crit');
    const hasWarn  = breaches.some(b => b.kind === 'warn');
    if (hasCrit) {
      card.dataset.state = 'crit';
      pillText.textContent = 'CRIT';
    } else if (hasWarn) {
      card.dataset.state = 'warn';
      pillText.textContent = 'WARN';
    } else {
      card.dataset.state = 'live';
      pillText.textContent = 'LIVE';
    }
  }

  function markCardOffline(card) {
    card.dataset.state = 'offline';
    card.querySelector('[data-role="pill"] .pill-text').textContent = 'OFFLINE';
    const alertsEl = card.querySelector('[data-role="alerts"]');
    alertsEl.textContent = 'No data';
    alertsEl.classList.remove('warn', 'crit');
  }

  function startMachine(machine) {
    const card = buildCard(machine);
    grid.appendChild(card);

    // Slow-poll the home page (1 Hz) — full-rate sampling lives on detail page.
    const source = DataSource.forMachine(machine, { pollMs: 1000 });
    let lastRxAt = 0;

    source.subscribe((packet, err) => {
      if (err || !packet) {
        // mark offline only after a few seconds of no successful read
        if (Date.now() - lastRxAt > 4000) markCardOffline(card);
        return;
      }
      lastRxAt = Date.now();
      const breaches = checkBreaches(packet);
      renderCard(card, packet, breaches);
      machineState.set(machine.id, { lastPacket: packet, breaches, lastRxAt });
      updateFleetSummary();
    });
    source.start();

    // Stale-data watchdog — if a machine stops reporting, fade it to offline
    setInterval(() => {
      if (Date.now() - lastRxAt > 5000 && card.dataset.state !== 'offline') {
        markCardOffline(card);
      }
    }, 1000);
  }

  function updateFleetSummary() {
    fleetCount.textContent  = MACHINES.length;
    let online = 0, alerting = 0;
    machineState.forEach(s => {
      if (Date.now() - s.lastRxAt < 5000) online++;
      if (s.breaches && s.breaches.length > 0) alerting++;
    });
    fleetOnline.textContent = online;
    fleetAlerts.textContent = alerting;
  }

  function tickClock() {
    const ms = Date.now() - sessionStart;
    const s  = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    fleetUptime.textContent = `${hh}:${mm}:${ss}`;
  }

  // ---- boot ----
  if (typeof MACHINES === 'undefined' || MACHINES.length === 0) {
    grid.innerHTML = '<p style="color:#888;padding:20px">No machines registered. Edit <code>js/machines.js</code>.</p>';
  } else {
    MACHINES.forEach(startMachine);
    updateFleetSummary();
  }

  setInterval(tickClock, 1000);
  setInterval(updateFleetSummary, 1000);
  tickClock();

})();
