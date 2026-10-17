// Storage backends for UU Bus ERP.
// The app keeps its data in memory and persists a JSON snapshot through one of these stores:
//   - FileStore     (default): files under DATA_DIR, atomic writes, daily backups.
//   - SupabaseStore (STORAGE=supabase): Postgres rows + Storage bucket — see lib/store-supabase.js.
//   - CatalystStore (STORAGE=catalyst): Zoho Catalyst Stratus — see lib/store-catalyst.js.
// Every method is async so cloud backends fit the same interface.
const fs = require('fs');
const path = require('path');

const BACKUP_KEEP_DAYS = 30;

class FileStore {
  constructor(dir) {
    this.name = 'local disk';
    this.dir = dir;
    this.dbFile = path.join(dir, 'db.json');
    this.voiceDir = path.join(dir, 'voice');
    this.backupDir = path.join(dir, 'backups');
  }
  async init() {
    for (const d of [this.dir, this.voiceDir, this.backupDir]) fs.mkdirSync(d, { recursive: true });
  }
  async loadDb() {
    return fs.existsSync(this.dbFile) ? fs.readFileSync(this.dbFile, 'utf8') : null;
  }
  async saveDb(text) {
    this.saveDbSync(text);
  }
  // Used on shutdown, when async work may not finish.
  saveDbSync(text) {
    const tmp = this.dbFile + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, this.dbFile);
  }
  async moveAside(suffix) {
    if (fs.existsSync(this.dbFile)) fs.renameSync(this.dbFile, this.dbFile.replace(/\.json$/, `.${suffix}.json`));
  }
  async backup(text, date) {
    const file = path.join(this.backupDir, `db-${date}.json`);
    if (fs.existsSync(file)) return false;
    fs.writeFileSync(file, text);
    const old = fs.readdirSync(this.backupDir).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - BACKUP_KEEP_DAYS)).forEach((f) => fs.unlinkSync(path.join(this.backupDir, f)));
    return true;
  }
  async listBackups() {
    return fs.readdirSync(this.backupDir).filter((f) => /^db-.*\.json$/.test(f)).sort().reverse()
      .map((f) => ({ name: f, size: fs.statSync(path.join(this.backupDir, f)).size }));
  }
  async putVoice(name, buf) {
    fs.writeFileSync(path.join(this.voiceDir, name), buf);
  }
  async getVoice(name) {
    const f = path.join(this.voiceDir, path.basename(name));
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  }
  async writeCredentials(text) {
    fs.writeFileSync(path.join(this.dir, 'initial-credentials.txt'), text);
  }
}

function createStore(dataDir) {
  const kind = (process.env.STORAGE || '').toLowerCase();
  if (kind === 'supabase') {
    const { SupabaseStore } = require('./store-supabase');
    return new SupabaseStore();
  }
  if (kind === 'catalyst') {
    const { CatalystStore } = require('./store-catalyst');
    return new CatalystStore();
  }
  return new FileStore(dataDir);
}

module.exports = { createStore, FileStore };
