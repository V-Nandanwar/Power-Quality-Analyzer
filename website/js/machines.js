// Registry of monitored machines.
// Each entry produces one card on the home page (index.html) and one detail
// view (dashboard.html?id=<id>). Edit this list to add or remove machines.
//
// `source: 'http'` → fetch live JSON from `httpUrl` (your real ESP8266).
// `source: 'mock'` → run the in-browser simulator with the named scenario.
//
// Available mockScenario values (defined in mock.js):
//   no_load         — idle, near zero current
//   resistive       — incandescent bulb-style, PF ≈ 1
//   inductive       — motor / fan, PF ~0.7
//   harmonic        — non-linear load, high THD
//   mixed           — combined real-world load
//   sag             — voltage sag event (CRITICAL alert)
//   swell           — voltage swell event (CRITICAL alert)
//   frequency_drift — frequency outside band (CRITICAL alert)

const MACHINES = [
  {
    id: 'pqa-01',
    name: 'Lab Bench Power Strip',
    location: 'EE Lab — Bench 4',
    serial: '000001',
    fw: '0.1.0',
    source: 'http',
    httpUrl: 'http://10.11.88.222/data',
  },
  {
    id: 'pqa-02',
    name: 'Workshop CNC Mill',
    location: 'Mech Workshop — Bay 2',
    serial: '000002',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'inductive',
  },
  {
    id: 'pqa-03',
    name: 'Server Room Rack 4',
    location: 'IT — Server Room',
    serial: '000003',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'harmonic',
  },
  {
    id: 'pqa-04',
    name: 'HVAC Compressor',
    location: 'Roof — Block C',
    serial: '000004',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'mixed',
  },
  {
    id: 'pqa-05',
    name: 'Library Lighting',
    location: 'Library — 2nd Floor',
    serial: '000005',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'resistive',
  },
  {
    id: 'pqa-06',
    name: 'Cafeteria Kitchen Mains',
    location: 'Cafeteria — Block A',
    serial: '000006',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'sag',
  },
  {
    id: 'pqa-07',
    name: 'Auditorium Stage Lights',
    location: 'Auditorium — Backstage',
    serial: '000007',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'swell',
  },
  {
    id: 'pqa-08',
    name: 'Pump Room Motor',
    location: 'Utility — Basement',
    serial: '000008',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'frequency_drift',
  },
  {
    id: 'pqa-09',
    name: 'Welding Bay Outlet',
    location: 'Mech Workshop — Bay 5',
    serial: '000009',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'harmonic',
  },
  {
    id: 'pqa-10',
    name: 'Standby Outlet',
    location: 'Storage — Block D',
    serial: '000010',
    fw: '0.1.0',
    source: 'mock',
    mockScenario: 'no_load',
  },
];

function getMachineById(id) {
  return MACHINES.find(m => m.id === id) || null;
}
