// Per-machine data source factory.
//
// DataSource.forMachine(machine, opts) returns a fresh, independent source
// (Mock / Http / Ws) for a single machine. Each call gives a distinct stream
// so the home page can run several at once without state collisions.

const DataSource = (() => {

  function forMachine(machine, opts) {
    opts = opts || {};
    if (!machine) {
      console.warn('DataSource.forMachine called with no machine');
      return MockSource.create('resistive');
    }
    switch (machine.source) {
      case 'http':
        return HttpSource.create(machine.httpUrl, opts.pollMs);
      case 'ws':
        return WsSource.create(machine.wsUrl);
      case 'mock':
      default:
        return MockSource.create(machine.mockScenario);
    }
  }

  return { forMachine };
})();
