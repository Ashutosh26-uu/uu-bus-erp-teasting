// Initial data used only when the database is first created.
// Real roster/staff details come from a private file that is never committed:
//   1. the path in the SEED_FILE environment variable (e.g. a Render "Secret File"), or
//   2. lib/seed.private.js (git-ignored, for local use).
// If neither exists (e.g. a fresh clone), sample data from lib/seed.example.js is used.
const fs = require('fs');
const path = require('path');

const candidates = [process.env.SEED_FILE, path.join(__dirname, 'seed.private.js')].filter(Boolean);
const found = candidates.find((p) => fs.existsSync(p));

if (found) {
  module.exports = require(path.resolve(found));
} else {
  console.warn('  Note: no private seed file found — starting with SAMPLE students and staff.');
  module.exports = require('./seed.example');
}
