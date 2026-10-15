// SAMPLE seed data — used only when lib/seed.private.js is missing (e.g. a fresh clone).
// The real UU-10 roster and staff details live in lib/seed.private.js, which is git-ignored.
// Copy that file to the server (or create your own with the same shape) before the first run.

const UU10_STOPS = [
  { name: 'Sample Stop A', time: '' },
  { name: 'Sample Stop B', time: '' },
  { name: 'Sample Stop C', time: '' },
  { name: 'United University (Campus)', time: '' },
];

// [enrollment, name, programme, stop]
const UU10_STUDENTS = [
  ['UU250000001', 'Sample Student One', 'COMP-BCA-2025-2-COMP', 'Sample Stop A'],
  ['UU250000002', 'Sample Student Two', 'MGMT-MBA-2025-2-COM_MGMT', 'Sample Stop A'],
  ['UU240000003', 'Sample Student Three', 'LAW-BALLB-2024-3-LAW', 'Sample Stop B'],
  ['UU260000004', 'Sample Student Four', 'BBA', 'Sample Stop C'],
];

// Login IDs and passwords are generated randomly on first run (see server.js).
// realName is kept on the server only and is never sent to the browser.
const STAFF = [
  { role: 'super', realName: 'Super Admin', name: 'Super Admin', bus: '*', phone: '', title: 'Super Admin' },
  { role: 'transport', name: 'Transport Incharge', bus: '*', phone: '', title: 'Transport Incharge' },
  { role: 'busincharge', name: 'UU-10 Bus Incharge', bus: 'UU-10', phone: '', title: 'Bus Incharge' },
  { role: 'coordinator', name: 'Coordinator (Girl)', bus: 'UU-10', phone: '', title: 'Student Coordinator (Girl)' },
  { role: 'coordinator', name: 'Coordinator (Boy)', bus: 'UU-10', phone: '', title: 'Student Coordinator (Boy)' },
];

const UNIVERSITY_LINE = 'United University, Prayagraj nurtures curious minds with industry-ready programmes, dedicated faculty and a vibrant green campus. Ride with us safely every day as we build the leaders of tomorrow.';

module.exports = { UU10_STOPS, UU10_STUDENTS, STAFF, UNIVERSITY_LINE };
