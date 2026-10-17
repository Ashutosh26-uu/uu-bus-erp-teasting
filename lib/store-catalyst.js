// Zoho Catalyst storage backend (used when STORAGE=catalyst, e.g. on Catalyst AppSail).
//
// AppSail containers have no durable disk, so the database snapshot, daily backups and voice notes
// are kept in a Catalyst Stratus bucket:
//   db/db.json                       current database
//   backups/db-YYYY-MM-DD.json       one copy per day
//   voice/<id>.<ext>                 voice messages
//   private/initial-credentials.txt  first-run admin logins
//
// Uses Catalyst's current modular SDK (@zcatalyst/stratus); the older zcatalyst-sdk-node 2.x has no Stratus.
// The SDK takes its credentials from the request headers that the Catalyst gateway adds, so the store keeps
// a reference to the latest incoming request (attach) and initialises the SDK from it. The server therefore
// loads the database on the first request instead of at start-up.
//
// Environment: ZOHO_STRATUS_BUCKET (bucket name, required).

let Stratus, ZCAuth;
try {
  ({ Stratus } = require('@zcatalyst/stratus'));
  ({ ZCAuth } = require('@zcatalyst/auth-admin')); // installed with @zcatalyst/stratus
} catch {
  throw new Error('STORAGE=catalyst needs the @zcatalyst/stratus package. Build with `npm run build:catalyst`.');
}

function streamToBuffer(res) {
  if (Buffer.isBuffer(res)) return Promise.resolve(res);
  if (typeof res === 'string') return Promise.resolve(Buffer.from(res));
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(Buffer.from(c)));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}
const isNotFound = (e) => /404|not\s*found|no\s*such|does not exist|NoSuchKey/i.test(`${e && (e.statusCode || e.status || '')} ${e && (e.message || e.code || '')}`);

class CatalystStore {
  constructor() {
    this.name = 'Zoho Catalyst Stratus';
    this.needsRequest = true;
    this.bucketName = process.env.ZOHO_STRATUS_BUCKET;
    this.req = null;
    if (!this.bucketName) throw new Error('Set ZOHO_STRATUS_BUCKET to the name of your Catalyst Stratus bucket.');
  }
  // Called for every incoming request so the SDK always has fresh gateway credentials.
  attach(req) {
    if (req && req.headers) this.req = req;
  }
  bucket() {
    if (!this.req) throw new Error('Catalyst storage is not ready yet (waiting for the first request).');
    // init(req) reads the Catalyst project headers from the request ("advancedio" initialisation).
    const app = new ZCAuth().init(this.req, { scope: 'admin' });
    return new Stratus(app).bucket(this.bucketName);
  }
  async put(key, data, contentType) {
    await this.bucket().putObject(key, data, { overwrite: true, ...(contentType ? { contentType } : {}) });
  }
  async get(key) {
    try {
      return await streamToBuffer(await this.bucket().getObject(key));
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async init() {}
  async loadDb() {
    const buf = await this.get('db/db.json');
    return buf ? buf.toString('utf8') : null;
  }
  async saveDb(text) {
    await this.put('db/db.json', text, 'application/json');
  }
  async moveAside(suffix) {
    const cur = await this.get('db/db.json');
    if (cur) await this.put(`db/db.${suffix}.json`, cur, 'application/json');
  }
  async backup(text, date) {
    await this.put(`backups/db-${date}.json`, text, 'application/json');
    return true;
  }
  async listBackups() {
    try {
      const res = await this.bucket().listPagedObjects({ prefix: 'backups/', maxKeys: 40 });
      const items = (res && (res.contents || res.objects || res.data || [])) || [];
      return items.map((o) => ({ name: String(o.key || o.name || '').replace(/^backups\//, ''), size: o.size || o.content_length || 0 }))
        .filter((o) => o.name).sort((a, b) => b.name.localeCompare(a.name));
    } catch { return []; }
  }
  async putVoice(name, buf) {
    await this.put(`voice/${name}`, buf);
  }
  async getVoice(name) {
    return this.get(`voice/${name}`);
  }
  async writeCredentials(text) {
    await this.put('private/initial-credentials.txt', text, 'text/plain');
  }
}

module.exports = { CatalystStore };
