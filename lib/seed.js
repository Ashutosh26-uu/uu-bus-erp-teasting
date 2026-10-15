// Initial data used only when the database is first created.
// Real roster/staff details live in lib/seed.private.js (git-ignored). If that file is
// missing (e.g. a fresh clone), sample data from lib/seed.example.js is used instead.
const fs = require('fs');
const path = require('path');

const PRIVATE = path.join(__dirname, 'seed.private.js');

if (fs.existsSync(PRIVATE)) {
  module.exports = require(PRIVATE);
} else {
  console.warn('  Note: lib/seed.private.js not found — starting with SAMPLE students and staff.');
  module.exports = require('./seed.example');
}
