// Chart.js setup and update helpers. All four charts live here.

const Charts = (() => {

  const baseGrid = { color: 'rgba(255,255,255,0.06)' };
  const baseTicks = { color: '#a7b3c4', font: { family: 'ui-monospace, Menlo, Consolas, monospace', size: 12 } };
  const axisTitle  = (text, color) => ({ display: true, text, color, font: { size: 12, weight: 600 } });

  Chart.defaults.color = '#a7b3c4';
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  Chart.defaults.font.size = 13;
  Chart.defaults.animation = false;
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;

  function setupTrendChart(canvas) {
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Voltage (V)',
            data: [],
            borderColor: '#4cc2ff',
            backgroundColor: 'rgba(76,194,255,0.1)',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.25,
            yAxisID: 'yV',
          },
          {
            label: 'Current (mA)',
            data: [],
            borderColor: '#ffb454',
            backgroundColor: 'rgba(255,180,84,0.08)',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.25,
            yAxisID: 'yI',
          },
        ],
      },
      options: {
        scales: {
          x: { grid: baseGrid, ticks: { ...baseTicks, maxTicksLimit: 6 } },
          yV: {
            position: 'left',
            grid: baseGrid,
            ticks: baseTicks,
            title: axisTitle('V', '#4cc2ff'),
            min: 200,
            max: 260,
          },
          yI: {
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: baseTicks,
            title: axisTitle('mA', '#ffb454'),
            min: 0,
            max: 1500,
          },
        },
        plugins: { legend: { labels: { boxWidth: 12, font: { size: 13 }, padding: 14 } } },
      },
    });
  }

  function setupPowerChart(canvas) {
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Real (W)',     data: [], borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,0.1)',  borderWidth: 1.5, pointRadius: 0, tension: 0.25 },
          { label: 'Apparent (VA)',data: [], borderColor: '#a371f7', backgroundColor: 'rgba(163,113,247,0.08)',borderWidth: 1.5, pointRadius: 0, tension: 0.25 },
          { label: 'Reactive (VAR)',data: [],borderColor: '#ff7b72', backgroundColor: 'rgba(255,123,114,0.08)',borderWidth: 1.5, pointRadius: 0, tension: 0.25 },
        ],
      },
      options: {
        scales: {
          x: { grid: baseGrid, ticks: { ...baseTicks, maxTicksLimit: 6 } },
          y: {
            grid: baseGrid,
            ticks: baseTicks,
            min: 0,
            max: 200,
          },
        },
        plugins: { legend: { labels: { boxWidth: 12, font: { size: 13 }, padding: 14 } } },
      },
    });
  }

  function setupHarmonicChart(canvas) {
    const labels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '% of fundamental',
          data: new Array(10).fill(0),
          backgroundColor: (ctx) => ctx.dataIndex === 0 ? '#4cc2ff' : '#7c5cff',
          borderRadius: 4,
        }],
      },
      options: {
        scales: {
          x: { grid: { display: false }, ticks: baseTicks },
          y: { grid: baseGrid, ticks: baseTicks, beginAtZero: true, suggestedMax: 20 },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  function setupWaveformChart(canvas) {
    const labels = Array.from({ length: 128 }, (_, i) => (i * 20 / 128).toFixed(1));
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Instantaneous voltage',
          data: new Array(128).fill(0),
          borderColor: '#4cc2ff',
          backgroundColor: 'rgba(76,194,255,0.08)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        scales: {
          x: {
            grid: baseGrid,
            ticks: { ...baseTicks, maxTicksLimit: 5, callback: (v, i) => `${labels[i]}ms` },
            title: axisTitle('time (ms)', '#8b96a7'),
          },
          y: { grid: baseGrid, ticks: baseTicks, title: axisTitle('V', '#8b96a7') },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  function pushTrend(chart, tsLabel, v, i, maxPoints) {
    chart.data.labels.push(tsLabel);
    chart.data.datasets[0].data.push(v);
    chart.data.datasets[1].data.push(i);
    while (chart.data.labels.length > maxPoints) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(d => d.data.shift());
    }
    chart.update('none');
  }

  function pushPower(chart, tsLabel, pReal, pApp, pReac, maxPoints) {
    chart.data.labels.push(tsLabel);
    chart.data.datasets[0].data.push(pReal);
    chart.data.datasets[1].data.push(pApp);
    chart.data.datasets[2].data.push(pReac);
    while (chart.data.labels.length > maxPoints) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(d => d.data.shift());
    }
    chart.update('none');
  }

  function updateHarmonics(chart, harmonics) {
    chart.data.datasets[0].data = harmonics;
    chart.update('none');
  }

  function updateWaveform(chart, samples) {
    chart.data.datasets[0].data = samples;
    chart.update('none');
  }

  return {
    setupTrendChart, setupPowerChart, setupHarmonicChart, setupWaveformChart,
    pushTrend, pushPower, updateHarmonics, updateWaveform,
  };
})();
