// One-time copy of the local database (data/db.json + voice notes) into Supabase.
//   node scripts/migrate-to-supabase.js            (refuses if Supabase already has data)
//   node scripts/migrate-to-supabase.js --force    (overwrite what is in Supabase)
// Stop the local server first. Afterwards run the app with STORAGE=supabase.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SupabaseStore } = require('../lib/store-supabase');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const force = process.argv.includes('--force');

(async () => {
  const file = path.join(DATA, 'db.json');
  if (!fs.existsSync(file)) throw new Error(`No local database at ${file}`);
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  // same upgrades the server applies on load
  db.events = db.events || [];
  (db.audit || []).forEach((a) => { if (!a.id) a.id = crypto.randomBytes(6).toString('hex'); });

  const store = new SupabaseStore();
  console.log('Connecting to Supabase …');
  await store.init();
  try {
    const existing = await store.loadDb();
    if (existing && !force) throw new Error('Supabase already contains UU Bus data. Re-run with --force to overwrite it.');
    // saveObject compares against what is in Supabase: uploads differences, deletes rows not in the local copy.
    const r = await store.saveObject(db);
    console.log(`Database rows uploaded: ${r.upserted}, removed: ${r.deleted}`);

    const voiceDir = path.join(DATA, 'voice');
    const voices = fs.existsSync(voiceDir) ? fs.readdirSync(voiceDir) : [];
    for (const v of voices) await store.putVoice(v, fs.readFileSync(path.join(voiceDir, v)));
    console.log(`Voice notes uploaded: ${voices.length}`);
    const cred = path.join(DATA, 'initial-credentials.txt');
    if (fs.existsSync(cred)) { await store.writeCredentials(fs.readFileSync(cred, 'utf8')); console.log('Initial credentials copied to the private bucket.'); }

    console.log(`\n✔ Done — ${db.students.length} students, ${db.staff.length} staff, ${db.attendance.length} attendance records.`);
    console.log('  Existing logins keep working. Start the app with STORAGE=supabase.');
  } finally {
    await store.release();
  }
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
