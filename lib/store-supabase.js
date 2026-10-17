// Supabase storage backend (STORAGE=supabase).
//
// Data lives in one Postgres table, uubus_records (see supabase/schema.sql): every student, staff member,
// session, attendance mark, chat, notice, security event and audit entry is its own row
// (collection + id + JSON data), so it can be browsed and queried in the Supabase dashboard.
// Settings and other single values are rows in the "_kv" collection.
// Voice notes, daily backups and the first-run credentials go to a private Storage bucket.
//
// The server keeps the data in memory; on every save this store sends only the rows that changed.
// A lease row prevents two servers (e.g. a PC and the cloud) from writing to the same database at once.
//
// Config: supabase.config.json { "url", "secretKey" } or env SUPABASE_URL + SUPABASE_SECRET_KEY.
// The SECRET key is required (server-side only). Never use it in the browser or commit it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const TABLE = 'uubus_records';
const BUCKET = process.env.SUPABASE_BUCKET || 'uubus-files';
const LEASE_TTL_MS = 90 * 1000;
const BACKUP_KEEP = 30;
const BATCH = 500;

// How each array in the database maps to rows. "ordered" keeps the list order; others sort by time on load.
const COLLECTIONS = {
  students: { key: 'enroll', ordered: true },
  staff: { key: 'username', ordered: true },
  buses: { key: 'id', ordered: true },
  notices: { key: 'id', ordered: true },
  sessions: { key: 'id', sort: 'createdAt' },
  attendance: { key: 'id', sort: 'at' },
  chats: { key: 'id', sort: 'at' },
  events: { key: 'id', sort: 'at' },
  audit: { key: 'id', sort: 'at' },
};

function readConfig() {
  const file = path.join(__dirname, '..', 'supabase.config.json');
  let c = {};
  if (fs.existsSync(file)) c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = process.env.SUPABASE_URL || c.url;
  const key = process.env.SUPABASE_SECRET_KEY || c.secretKey;
  if (!url || !key || /PASTE|YOUR_/i.test(key)) throw new Error('Supabase is not configured: put your project URL and SECRET key in supabase.config.json.');
  if (/^sb_publishable_/.test(key)) throw new Error('supabase.config.json has the PUBLISHABLE key. The server needs the SECRET key (Supabase → Project Settings → API Keys → Secret keys).');
  return { url, key };
}

class SupabaseStore {
  constructor() {
    const { url, key } = readConfig();
    this.name = 'Supabase';
    this.sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    this.instance = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    this.saved = new Map(); // "collection|id" -> last saved JSON
    this.leaseLost = false;
  }

  // ---------- lease (single writer) ----------
  async readLease() {
    const { data, error } = await this.sb.from(TABLE).select('data').eq('collection', '_lease').eq('id', 'writer').maybeSingle();
    if (error) throw this.explain(error);
    return data ? data.data : null;
  }
  async writeLease() {
    const { error } = await this.sb.from(TABLE).upsert({ collection: '_lease', id: 'writer', data: { instance: this.instance, host: os.hostname(), at: Date.now() } }, { onConflict: 'collection,id' });
    if (error) throw this.explain(error);
  }
  async acquireLease() {
    const cur = await this.readLease();
    if (cur && cur.instance !== this.instance && Date.now() - cur.at < LEASE_TTL_MS) {
      throw new Error(`The database is in use by another server (${cur.host}, active ${Math.round((Date.now() - cur.at) / 1000)} s ago). Stop that server, or wait ${Math.round(LEASE_TTL_MS / 1000)} s after it stops.`);
    }
    await this.writeLease();
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(async () => {
      try {
        const cur2 = await this.readLease();
        if (cur2 && cur2.instance !== this.instance && Date.now() - cur2.at < LEASE_TTL_MS) {
          this.leaseLost = true;
          console.error(`Another server (${cur2.host}) took over the database — this server stops saving.`);
          clearInterval(this.heartbeat);
          return;
        }
        await this.writeLease();
      } catch (e) { console.error('Lease heartbeat failed:', e.message); }
    }, 30 * 1000);
    this.heartbeat.unref();
  }
  async release() {
    clearInterval(this.heartbeat);
    if (this.leaseLost) return;
    try { await this.sb.from(TABLE).delete().eq('collection', '_lease').eq('id', 'writer').eq('data->>instance', this.instance); } catch {}
  }

  explain(error) {
    const msg = error.message || String(error);
    if (/relation .*uubus_records.* does not exist|Could not find the table/i.test(msg)) return new Error('The uubus_records table is missing. Run supabase/schema.sql in the Supabase SQL Editor once.');
    if (/Invalid API key|JWT|401|permission denied/i.test(msg)) return new Error(`Supabase rejected the key (${msg}). Use the project's SECRET key.`);
    return new Error(`Supabase: ${msg}`);
  }

  // ---------- rows <-> database object ----------
  toRows(db) {
    const rows = new Map();
    for (const [k, v] of Object.entries(db)) {
      const spec = COLLECTIONS[k];
      if (spec && Array.isArray(v)) {
        v.forEach((rec, i) => {
          const id = String(rec[spec.key]);
          const data = JSON.stringify(rec);
          rows.set(`${k}|${id}`, { collection: k, id, json: spec.ordered ? data + '#' + i : data, data, pos: spec.ordered ? i : null, rec });
        });
      } else {
        const data = JSON.stringify(v);
        rows.set(`_kv|${k}`, { collection: '_kv', id: k, json: data, data, pos: null, rec: v });
      }
    }
    return rows;
  }
  dayOf(rec) {
    return (rec && (rec.date || String(rec.at || rec.createdAt || '').slice(0, 10))) || null;
  }

  async init() {
    // Private bucket for voice notes, backups and credentials (created automatically).
    const { error } = await this.sb.storage.getBucket(BUCKET);
    if (error) {
      const { error: e2 } = await this.sb.storage.createBucket(BUCKET, { public: false });
      if (e2 && !/already exists/i.test(e2.message)) throw this.explain(e2);
    }
    await this.acquireLease();
  }

  async loadDb() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.sb.from(TABLE).select('collection,id,data,pos').neq('collection', '_lease').order('collection').order('id').range(from, from + 999);
      if (error) throw this.explain(error);
      all.push(...data);
      if (data.length < 1000) break;
    }
    if (!all.length) return null;
    const db = {};
    const lists = {};
    for (const r of all) {
      if (r.collection === '_kv') db[r.id] = r.data;
      else (lists[r.collection] = lists[r.collection] || []).push(r);
    }
    for (const [k, spec] of Object.entries(COLLECTIONS)) {
      const rs = lists[k] || [];
      if (spec.ordered) rs.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
      else rs.sort((a, b) => String(a.data[spec.sort] || '').localeCompare(String(b.data[spec.sort] || '')));
      db[k] = rs.map((r) => r.data);
    }
    const text = JSON.stringify(db);
    // The server parses exactly this text, so these rows are the baseline for change detection.
    for (const [key, row] of this.toRows(JSON.parse(text))) this.saved.set(key, row.json);
    return text;
  }

  // Sends only new/changed rows and deletes removed ones. The diff is computed synchronously,
  // so later changes to the in-memory data can't mix into this save.
  async saveObject(db) {
    if (this.leaseLost) throw new Error('Another server now owns the database; not saving.');
    const rows = this.toRows(db);
    const upserts = [];
    for (const [key, row] of rows) {
      if (this.saved.get(key) !== row.json) {
        upserts.push({ key, json: row.json, body: { collection: row.collection, id: row.id, data: JSON.parse(row.data), pos: row.pos, bus: (row.rec && row.rec.bus) || null, day: row.collection === '_kv' ? null : this.dayOf(row.rec), updated_at: new Date().toISOString() } });
      }
    }
    const removed = [...this.saved.keys()].filter((k) => !rows.has(k));
    for (let i = 0; i < upserts.length; i += BATCH) {
      const chunk = upserts.slice(i, i + BATCH);
      const { error } = await this.sb.from(TABLE).upsert(chunk.map((u) => u.body), { onConflict: 'collection,id' });
      if (error) throw this.explain(error);
      chunk.forEach((u) => this.saved.set(u.key, u.json));
    }
    const byColl = {};
    removed.forEach((k) => { const [c, ...id] = k.split('|'); (byColl[c] = byColl[c] || []).push(id.join('|')); });
    for (const [c, ids] of Object.entries(byColl)) {
      for (let i = 0; i < ids.length; i += BATCH) {
        const part = ids.slice(i, i + BATCH);
        const { error } = await this.sb.from(TABLE).delete().eq('collection', c).in('id', part);
        if (error) throw this.explain(error);
        part.forEach((id) => this.saved.delete(`${c}|${id}`));
      }
    }
    return { upserted: upserts.length, deleted: removed.length };
  }

  // ---------- files ----------
  async putFile(p, data, contentType) {
    const { error } = await this.sb.storage.from(BUCKET).upload(p, data, { contentType, upsert: true });
    if (error) throw this.explain(error);
  }
  async getFile(p) {
    const { data, error } = await this.sb.storage.from(BUCKET).download(p);
    if (error) {
      if (/not found|404|Object not found/i.test(error.message || '') || error.statusCode === '404') return null;
      throw this.explain(error);
    }
    return Buffer.from(await data.arrayBuffer());
  }
  async moveAside(suffix) {
    const text = await this.loadDb();
    if (text) await this.putFile(`backups/db-${suffix}-${Date.now()}.json`, text, 'application/json');
    this.saved.clear();
  }
  async backup(text, date) {
    await this.putFile(`backups/db-${date}.json`, text, 'application/json');
    try {
      const list = await this.listBackups();
      const old = list.filter((b) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(b.name)).slice(BACKUP_KEEP);
      if (old.length) await this.sb.storage.from(BUCKET).remove(old.map((b) => `backups/${b.name}`));
    } catch {}
    return true;
  }
  async listBackups() {
    const { data, error } = await this.sb.storage.from(BUCKET).list('backups', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
    if (error) return [];
    return data.filter((f) => f.name.endsWith('.json')).map((f) => ({ name: f.name, size: (f.metadata && f.metadata.size) || 0 }));
  }
  async putVoice(name, buf) { await this.putFile(`voice/${name}`, buf, 'application/octet-stream'); }
  async getVoice(name) { return this.getFile(`voice/${path.basename(name)}`); }
  async writeCredentials(text) { await this.putFile('private/initial-credentials.txt', text, 'text/plain'); }
}

module.exports = { SupabaseStore, TABLE, BUCKET };
