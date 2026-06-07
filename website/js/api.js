// Real-hardware data sources. Same subscribe(cb) interface as MockSource.
// Each call to .create() returns an independent instance bound to one URL,
// so the home page can poll multiple machines concurrently.

const HttpSource = (() => {

  function create(url, pollMs) {
    const interval = pollMs || (CONFIG && CONFIG.POLL_MS) || 1000;
    let timerId = null;
    const subscribers = new Set();

    async function poll() {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const packet = await res.json();
        subscribers.forEach(cb => {
          try { cb(packet); } catch (e) { console.error(e); }
        });
      } catch (err) {
        subscribers.forEach(cb => {
          try { cb(null, err); } catch (e) { console.error(e); }
        });
      }
    }

    function start() {
      if (timerId) return;
      poll();
      timerId = setInterval(poll, interval);
    }

    function stop() { if (timerId) { clearInterval(timerId); timerId = null; } }
    function subscribe(cb) { subscribers.add(cb); return () => subscribers.delete(cb); }

    return {
      start, stop, subscribe,
      setScenario: () => {},
      getScenario: () => null,
      mode: 'http',
    };
  }

  return { create };
})();

const WsSource = (() => {

  function create(url) {
    let ws = null;
    let reconnectTimer = null;
    const subscribers = new Set();

    function emit(packet, err) {
      subscribers.forEach(cb => {
        try { cb(packet, err); } catch (e) { console.error(e); }
      });
    }

    function connect() {
      try {
        ws = new WebSocket(url);
      } catch (e) {
        emit(null, e);
        scheduleReconnect();
        return;
      }
      ws.onmessage = (ev) => {
        try { emit(JSON.parse(ev.data)); }
        catch (e) { emit(null, e); }
      };
      ws.onerror = (e) => emit(null, e);
      ws.onclose = () => { scheduleReconnect(); };
    }

    function scheduleReconnect() {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 2000);
    }

    function start() { if (!ws) connect(); }
    function stop() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) { ws.close(); ws = null; }
    }
    function subscribe(cb) { subscribers.add(cb); return () => subscribers.delete(cb); }

    return {
      start, stop, subscribe,
      setScenario: () => {},
      getScenario: () => null,
      mode: 'ws',
    };
  }

  return { create };
})();
