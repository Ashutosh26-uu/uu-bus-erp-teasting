// United University — Bus ERP server (zero dependencies, Node 22+).
// Run: node server.js   →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { buildXlsx } = require('./lib/xlsx');
const { sendMail } = require('./lib/mailer');
const { externalSmtp, explainSmtpError } = require('./lib/smtp-config');
const seed = require('./lib/seed');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const VOICE_DIR = path.join(DATA_DIR, 'voice');
const CRED_FILE = path.join(DATA_DIR, 'initial-credentials.txt');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TZ = 'Asia/Kolkata';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MANUAL_WINDOW_MS = 60 * 60 * 1000; // admins may mark manually up to 1 hour after the OTP closes
const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_MINUTES = 240;
const TRIPS = ['Morning', 'Evening'];
const BUSES = Array.from({ length: 21 }, (_, i) => `UU-${i + 1}`);
const RANGES = { '1d': 1, '7d': 7, '1m': 30, '3m': 90, '6m': 180 };
const ADMIN_ROLES = ['super', 'transport', 'busincharge'];

// ---------- helpers ----------
const uid = (n = 12) => crypto.randomBytes(n).toString('hex');
function hashPassword(pw, salt = uid(16)) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function checkPassword(pw, rec) {
  if (!rec) return false;
  const h = crypto.scryptSync(String(pw), rec.salt, 32);
  const want = Buffer.from(rec.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
function randomPassword(len = 10) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*!'];
  const all = sets.join('');
  const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (chars.length < len) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
const fmtDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const fmtTime = (d = new Date()) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
const istHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()));
const defaultTrip = () => (istHour() < 12 ? 'Morning' : 'Evening');
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
function rangeFrom(key, fallback = '7d') {
  const days = RANGES[key] || RANGES[fallback];
  const to = fmtDate();
  return { key: RANGES[key] ? key : fallback, from: addDays(to, -(days - 1)), to };
}
function maskEmail(e) {
  const [u, d] = String(e).split('@');
  if (!d) return '';
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '*'.repeat(Math.max(1, u.length - 3)) + u.slice(-1)) + '@' + d;
}

// Department / course / year / semester from the programme string + enrollment.
const DEPT_CODES = { AGRI: 'Agriculture', COMP: 'Computer Applications', ENG: 'Engineering & Technology', LAW: 'Law', MGMT: 'Management', NUR: 'Nursing', PHARM: 'Pharmacy' };
function academicInfo(st) {
  const p = st.programme || '';
  let dept = '', course = p, spec = '';
  let adm = null;
  const m = p.match(/^([A-Z]+)-(.+)-(\d{4})-(\d+)-(.+)$/i);
  if (m) {
    dept = DEPT_CODES[m[1].toUpperCase()] || m[1];
    course = m[2].replace(/-/g, ' ');
    adm = Number(m[3]);
    if (m[1].toUpperCase() === 'ENG') spec = m[5];
  } else {
    const u = p.toUpperCase();
    if (/LLB|LAW/.test(u)) dept = 'Law';
    else if (/BCA|COMP/.test(u)) dept = 'Computer Applications';
    else if (/B\.?\s?TECH/.test(u)) dept = 'Engineering & Technology';
    else if (/NUR/.test(u)) dept = 'Nursing';
    else if (/AGRI/.test(u)) dept = 'Agriculture';
    else if (/PHARM/.test(u)) dept = 'Pharmacy';
    else if (/FASHION/.test(u)) dept = 'Fashion Design';
    else if (/B\.?\s?COM/.test(u)) dept = 'Commerce';
    else if (/BBA|MBA/.test(u)) dept = 'Management';
  }
  if (!adm) {
    const e = String(st.enroll).match(/^UU(\d{2})/i);
    if (e) adm = 2000 + Number(e[1]);
  }
  const now = new Date();
  const month = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'numeric' }).format(now));
  const yearNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric' }).format(now));
  const acad = month >= 7 ? yearNow : yearNow - 1;
  let year = adm ? Math.min(6, Math.max(1, acad - adm + 1)) : null;
  if (st.yearOverride) year = Number(st.yearOverride);
  const semester = st.semOverride ? Number(st.semOverride) : year ? (year - 1) * 2 + (month >= 7 ? 1 : 2) : null;
  return {
    department: st.deptOverride || dept || '—',
    course: course && course !== '—' ? course : '—',
    specialization: spec,
    admissionYear: adm,
    year, semester,
  };
}

// ---------- database ----------
let db;
function uniqueId(prefix, taken) {
  let id;
  do id = prefix + String(crypto.randomInt(1000, 10000)); while (taken.has(id));
  taken.add(id);
  return id;
}
function createDb() {
  const taken = new Set();
  const creds = [];
  const staff = seed.STAFF.map((s) => {
    const prefix = { super: 'UUSA', transport: 'UUAD', busincharge: 'UUAD', coordinator: 'UUSC' }[s.role];
    const username = uniqueId(prefix, taken);
    const password = randomPassword();
    creds.push({ username, password, title: s.title, name: s.role === 'super' ? `${s.realName} (shown as "Super Admin")` : s.name, bus: s.bus });
    return { ...s, username, email: '', active: true, pw: hashPassword(password) };
  });
  const data = {
    version: 2,
    createdAt: new Date().toISOString(),
    buses: BUSES.map((id) => ({ id, route: id === 'UU-10' ? 'Jhunsi – Trivenipuram – Prayagraj – United University' : '', driver: '', driverPhone: '', vehicleNo: '' })),
    stops: { 'UU-10': seed.UU10_STOPS.map((s) => ({ id: uid(4), ...s })) },
    settings: Object.fromEntries(BUSES.map((b) => [b, { otpMinutes: 10 }])),
    smtp: { host: '', port: 465, user: '', pass: '', from: '' },
    students: seed.UU10_STUDENTS.map(([enroll, name, programme, stop]) => ({ enroll, name, programme, stop, bus: 'UU-10', phone: '', active: true })),
    staff,
    sessions: [],
    attendance: [],
    chats: [],
    notices: [{
      id: uid(6), bus: 'UU-10', title: 'Welcome to UU-10 Bus Portal',
      body: 'Attendance opens only when the bus incharge generates an OTP inside the bus. Please be at your stop 5 minutes before the bus arrives.',
      pinned: true, by: 'Transport Incharge', at: new Date().toISOString(),
    }],
    resets: {},
    audit: [],
    tokens: {},
  };
  const lines = [
    'UNITED UNIVERSITY — BUS ERP: INITIAL LOGIN CREDENTIALS',
    `Generated: ${fmtDate()} ${fmtTime()} IST`,
    'Keep this file private. Share each ID/password only with its owner, then delete this file.',
    'Passwords can be changed after login, or reset by e-mail OTP once an e-mail is saved.',
    '',
    ...creds.map((c) => `${c.title.padEnd(28)} ${c.name.padEnd(46)} ID: ${c.username.padEnd(10)} Password: ${c.password}`),
    '',
  ];
  fs.writeFileSync(CRED_FILE, lines.join('\n'));
  console.log('\n' + lines.join('\n'));
  return data;
}
function loadDb() {
  fs.mkdirSync(VOICE_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (db.version !== 2) {
      const bak = DB_FILE.replace(/\.json$/, `.v${db.version || 1}.bak.json`);
      fs.renameSync(DB_FILE, bak);
      console.log('Old database format moved to', bak);
      db = createDb();
      saveNow();
    }
  } else {
    db = createDb();
    saveNow();
    console.log('Created new database at', DB_FILE);
  }
}
let saveTimer = null;
function saveNow() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { saveNow(); } catch (e) { console.error('DB save failed', e); }
  }, 200);
}

// Public-facing name: the super admin's real name is never exposed.
const displayName = (acc) => (acc.role === 'super' ? 'Super Admin' : acc.name);
const displayWho = (acc) => (acc.role === 'super' ? 'Super Admin' : `${acc.title} — ${acc.name}`);
function audit(acc, action, detail, bus) {
  db.audit.push({ at: new Date().toISOString(), user: acc ? `${displayName(acc)} (${acc.username || acc.enroll})` : 'system', role: acc?.role || 'student', action, detail, bus: bus || acc?.bus });
  if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
}

// ---------- staff auth ----------
function publicStaff(u) {
  return { role: u.role, username: u.username, name: displayName(u), title: u.title, bus: u.bus, phone: u.phone, email: u.email || '' };
}
const findStaff = (id) => db.staff.find((s) => s.username.toLowerCase() === String(id).trim().toLowerCase());
function issueToken(id) {
  const token = uid(24);
  const now = Date.now();
  for (const [t, v] of Object.entries(db.tokens)) if (v.exp < now) delete db.tokens[t];
  db.tokens[token] = { id, exp: now + TOKEN_TTL_MS };
  save();
  return token;
}
function revokeTokens(username) {
  for (const [t, v] of Object.entries(db.tokens)) if (v.id === username) delete db.tokens[t];
}
function authFromReq(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const t = db.tokens[token];
  if (!t || t.exp < Date.now()) return null;
  const acc = findStaff(t.id);
  if (!acc || acc.active === false) return null;
  return { token, acc, role: acc.role };
}
function canAdminBus(auth, bus) {
  if (!auth || !ADMIN_ROLES.includes(auth.role) || !BUSES.includes(bus)) return false;
  return auth.acc.bus === '*' || auth.acc.bus === bus;
}

// generic limiter
const limits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const r = limits.get(key);
  if (!r || now - r.first > windowMs) { limits.set(key, { count: 1, first: now }); return false; }
  r.count++;
  return r.count > max;
}
const loginFails = new Map();
function loginBlocked(key) {
  const r = loginFails.get(key);
  if (!r) return false;
  if (Date.now() - r.first > 15 * 60 * 1000) { loginFails.delete(key); return false; }
  return r.count >= 8;
}
function loginFail(key) {
  const r = loginFails.get(key);
  if (!r || Date.now() - r.first > 15 * 60 * 1000) loginFails.set(key, { count: 1, first: Date.now() });
  else r.count++;
}

// ---------- attendance sessions ----------
function activeSession(bus) {
  const now = Date.now();
  let s = null;
  for (const x of db.sessions) {
    if (x.bus !== bus || x.closedAt) continue;
    if (new Date(x.expiresAt).getTime() <= now) {
      x.closedAt = x.expiresAt; x.closedReason = 'expired'; save();
      continue;
    }
    s = x;
  }
  return s;
}
const sessionEnd = (s) => new Date(s.closedAt || s.expiresAt).getTime();
const manualUntil = (s) => sessionEnd(s) + MANUAL_WINDOW_MS;
function latestSession(bus) {
  let last = null;
  for (const x of db.sessions) if (x.bus === bus && (!last || x.createdAt > last.createdAt)) last = x;
  return last;
}
// The session an admin is "working on": the open one, or the last one if its manual window is still running.
function workingSession(bus) {
  const open = activeSession(bus);
  if (open) return open;
  const last = latestSession(bus);
  if (last && Date.now() <= manualUntil(last)) return last;
  return null;
}
const genOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const findRecord = (enroll, date, trip) => db.attendance.find((a) => a.enroll === enroll && a.date === date && a.trip === trip);
const busStudents = (bus) => db.students.filter((s) => s.bus === bus && s.active !== false);
function sessionView(s, withOtp) {
  if (!s) return null;
  const v = {
    id: s.id, bus: s.bus, trip: s.trip, date: s.date, createdBy: s.createdByName, createdByUser: s.createdBy,
    createdAt: s.createdAt, expiresAt: s.expiresAt, closedAt: s.closedAt || null,
    open: !s.closedAt && new Date(s.expiresAt).getTime() > Date.now(),
    manualUntil: new Date(manualUntil(s)).toISOString(), serverNow: new Date().toISOString(),
  };
  if (withOtp) v.otp = s.otp;
  return v;
}
const heldKeys = (bus, from, to) => {
  const set = new Set();
  db.sessions.filter((s) => s.bus === bus && s.date >= from && s.date <= to).forEach((s) => set.add(`${s.date}|${s.trip}`));
  return set;
};
function countFor(bus, date, trip) {
  const ids = new Set(busStudents(bus).map((s) => s.enroll));
  return db.attendance.filter((a) => a.bus === bus && a.date === date && a.trip === trip && ids.has(a.enroll)).length;
}
function studentCard(st) {
  return { enroll: st.enroll, name: st.name, programme: st.programme, stop: st.stop, bus: st.bus, phone: st.phone || '', ...academicInfo(st) };
}

// ---------- HTTP plumbing ----------
function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
const ok = (res, obj = { ok: true }) => send(res, 200, obj);
const fail = (res, code, msg, extra = {}) => send(res, code, { error: msg, ...extra });
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Upload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf8');
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return fail(res, 400, 'Bad path'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) {
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => {
        if (e2) return fail(res, 404, 'Not found');
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(idx);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- routes ----------
const routes = {};
const route = (method, p, fn, opts = {}) => (routes[`${method} ${p}`] = { fn, ...opts });

route('GET', '/api/health', (req, res) => ok(res, { ok: true, time: new Date().toISOString() }));

// ======== PUBLIC (students — no login) ========
route('GET', '/api/public/home', (req, res) => {
  ok(res, {
    tagline: seed.UNIVERSITY_LINE,
    serverNow: new Date().toISOString(),
    buses: db.buses.map((b) => ({ id: b.id, route: b.route, students: busStudents(b.id).length, live: !!activeSession(b.id) })),
  });
});

route('GET', '/api/public/roster', (req, res, { query }) => {
  const bus = query.bus;
  if (!BUSES.includes(bus)) return fail(res, 404, 'Unknown bus');
  ok(res, { bus, students: busStudents(bus).map((s) => ({ enroll: s.enroll, name: s.name, stop: s.stop })).sort((a, b) => a.name.localeCompare(b.name)) });
});

function publicStudent(query, res) {
  const st = db.students.find((s) => s.enroll === String(query.enroll || '').toUpperCase());
  if (!st || st.active === false) { fail(res, 404, 'This student is no longer registered on this bus.', { code: 'REMOVED' }); return null; }
  if (query.bus && st.bus !== query.bus) { fail(res, 404, `This student has been moved to bus ${st.bus}.`, { code: 'MOVED', bus: st.bus }); return null; }
  return st;
}

route('GET', '/api/public/student', (req, res, { query }) => {
  const st = publicStudent(query, res);
  if (!st) return;
  const open = activeSession(st.bus);
  const last = open || latestSession(st.bus);
  const today = fmtDate();
  let current = null;
  if (last && last.date === today) {
    const r = findRecord(st.enroll, last.date, last.trip);
    current = { trip: last.trip, date: last.date, marked: !!r, time: r?.time || null, method: r?.method || null };
  }
  const todayRecs = db.attendance.filter((a) => a.enroll === st.enroll && a.date === today).map((a) => ({ trip: a.trip, time: a.time, method: a.method }));
  const unread = db.chats.filter((c) => c.enroll === st.enroll && c.from === 'staff' && !c.readByStudent).length;
  ok(res, {
    student: studentCard(st),
    session: open ? { ...sessionView(open, false), alreadyMarked: !!findRecord(st.enroll, open.date, open.trip), attemptsLeft: MAX_OTP_ATTEMPTS - ((open.attempts || {})[st.enroll] || 0) } : null,
    current, today, todayRecords: todayRecs, unreadChats: unread, serverNow: new Date().toISOString(),
  });
});

route('POST', '/api/public/mark', (req, res, { body, ip }) => {
  const st = publicStudent({ enroll: body.enroll, bus: body.bus }, res);
  if (!st) return;
  const s = activeSession(st.bus);
  if (!s) return fail(res, 409, 'Attendance portal is closed. Wait for the bus incharge to share the OTP.');
  if (findRecord(st.enroll, s.date, s.trip)) return fail(res, 409, `Already marked for the ${s.trip} trip today.`);
  s.attempts = s.attempts || {};
  s.ipFails = s.ipFails || {};
  const used = s.attempts[st.enroll] || 0;
  if (used >= MAX_OTP_ATTEMPTS) return fail(res, 429, 'Too many wrong OTP attempts. Ask the bus incharge to mark you manually.');
  if ((s.ipFails[ip] || 0) >= 15) return fail(res, 429, 'Too many wrong OTP attempts from this network.');
  const otp = String(body.otp || '').replace(/\D/g, '');
  if (otp !== s.otp) {
    s.attempts[st.enroll] = used + 1;
    s.ipFails[ip] = (s.ipFails[ip] || 0) + 1;
    save();
    const left = MAX_OTP_ATTEMPTS - used - 1;
    return fail(res, 400, `Wrong OTP. ${left} attempt${left === 1 ? '' : 's'} left.`);
  }
  const deviceId = clean(body.deviceId, 80) || 'unknown';
  s.devices = s.devices || {};
  if (deviceId !== 'unknown' && s.devices[deviceId] && s.devices[deviceId] !== st.enroll) {
    audit(null, 'proxy-blocked', `${st.name} (${st.enroll}) tried on a phone already used by ${s.devices[deviceId]}`, st.bus);
    save();
    return fail(res, 403, 'This phone has already marked another student for this trip. Each student must use their own phone.');
  }
  s.devices[deviceId] = st.enroll;
  const now = new Date();
  db.attendance.push({
    id: uid(8), sessionId: s.id, bus: st.bus, enroll: st.enroll, date: s.date, trip: s.trip,
    time: fmtTime(now), at: now.toISOString(), method: 'SELF', markedBy: st.name, device: deviceId.slice(0, 12), ip,
  });
  save();
  ok(res, { ok: true, record: { trip: s.trip, date: s.date, time: fmtTime(now) } });
});

route('GET', '/api/public/history', (req, res, { query }) => {
  const st = publicStudent(query, res);
  if (!st) return;
  const r = rangeFrom(query.range, '7d');
  const held = heldKeys(st.bus, r.from, r.to);
  const recs = db.attendance.filter((a) => a.enroll === st.enroll && a.date >= r.from && a.date <= r.to).sort((a, b) => b.at.localeCompare(a.at));
  recs.forEach((x) => held.add(`${x.date}|${x.trip}`));
  // per-trip list with absences
  const rows = [...held].sort().reverse().map((k) => {
    const [date, trip] = k.split('|');
    const rec = recs.find((x) => x.date === date && x.trip === trip);
    return { date, trip, present: !!rec, time: rec?.time || null, method: rec?.method || null, markedBy: rec ? (rec.method === 'SELF' ? 'Self' : rec.markedBy) : null };
  });
  ok(res, { range: r.key, from: r.from, to: r.to, held: held.size, present: recs.length, rows });
});

route('GET', '/api/public/info', (req, res, { query }) => {
  const bus = query.bus;
  if (!BUSES.includes(bus)) return fail(res, 404, 'Unknown bus');
  const studs = busStudents(bus);
  ok(res, {
    bus: db.buses.find((x) => x.id === bus),
    stops: (db.stops[bus] || []).map((s, i) => ({ ...s, order: i + 1, students: studs.filter((st) => st.stop === s.name).length })),
    contacts: db.staff
      .filter((s) => s.active !== false && s.role !== 'super' && (s.bus === bus || s.bus === '*'))
      .sort((a, b) => ['transport', 'busincharge', 'coordinator'].indexOf(a.role) - ['transport', 'busincharge', 'coordinator'].indexOf(b.role))
      .map((s) => ({ name: s.name, title: s.title, phone: s.phone, role: s.role })),
    notices: db.notices.filter((n) => n.bus === bus || n.bus === '*').sort((a, b) => (b.pinned - a.pinned) || b.at.localeCompare(a.at)),
    total: studs.length,
  });
});

// ----- chat (student side) -----
function chatView(c) {
  return { id: c.id, from: c.from, by: c.from === 'staff' ? c.staffName : null, type: c.type, text: c.text || '', voice: c.voiceId ? `/api/voice/${c.voiceId}` : null, duration: c.duration || 0, at: c.at };
}
route('GET', '/api/public/chat', (req, res, { query }) => {
  const st = publicStudent(query, res);
  if (!st) return;
  const msgs = db.chats.filter((c) => c.enroll === st.enroll);
  let changed = false;
  msgs.forEach((c) => { if (c.from === 'staff' && !c.readByStudent) { c.readByStudent = true; changed = true; } });
  if (changed) save();
  ok(res, { messages: msgs.slice(-200).map(chatView) });
});
const VOICE_TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/wav': 'wav' };
route('POST', '/api/public/chat', (req, res, { body, ip }) => {
  const st = publicStudent({ enroll: body.enroll, bus: body.bus }, res);
  if (!st) return;
  if (limited(`chat|${st.enroll}`, 20, 10 * 60 * 1000) || limited(`chatip|${ip}`, 60, 10 * 60 * 1000)) return fail(res, 429, 'You are sending messages too quickly. Please wait a few minutes.');
  const msg = { id: uid(8), bus: st.bus, enroll: st.enroll, from: 'student', at: new Date().toISOString(), readByStaff: false };
  if (body.audio) {
    const mime = String(body.mime || '').split(';')[0];
    const ext = VOICE_TYPES[mime];
    if (!ext) return fail(res, 400, 'Unsupported audio format');
    const buf = Buffer.from(String(body.audio), 'base64');
    if (buf.length < 200) return fail(res, 400, 'Voice message is empty');
    if (buf.length > 3 * 1024 * 1024) return fail(res, 400, 'Voice message too long (max ~2 minutes)');
    const voiceId = uid(12);
    fs.writeFileSync(path.join(VOICE_DIR, `${voiceId}.${ext}`), buf);
    Object.assign(msg, { type: 'voice', voiceId, voiceExt: ext, voiceMime: mime, duration: Math.min(300, Math.max(0, Math.round(Number(body.duration) || 0))) });
  } else {
    const text = clean(body.text, 1000);
    if (!text) return fail(res, 400, 'Type a message');
    Object.assign(msg, { type: 'text', text });
  }
  db.chats.push(msg);
  save();
  ok(res, { message: chatView(msg) });
}, { limit: 4.5 * 1024 * 1024 });


// ======== STAFF AUTH ========
route('POST', '/api/login', (req, res, { body, ip }) => {
  const id = clean(body.id, 60);
  const key = `${ip}|${id.toLowerCase()}`;
  if (!id || !body.password) return fail(res, 400, 'Enter your login ID and password.');
  if (loginBlocked(key)) return fail(res, 429, 'Too many failed attempts. Try again in 15 minutes.');
  const acc = findStaff(id);
  if (!acc || acc.active === false || !checkPassword(body.password, acc.pw)) {
    loginFail(key);
    return fail(res, 401, 'Invalid login ID or password.');
  }
  const want = body.role;
  const okRole = want === 'super' ? acc.role === 'super' : want === 'admin' ? ['transport', 'busincharge'].includes(acc.role) : want === 'coordinator' ? acc.role === 'coordinator' : true;
  if (!okRole) {
    const label = { super: 'Super Admin', admin: 'Administrative Admin', coordinator: 'Student Coordinator' }[want] || want;
    return fail(res, 403, `This ID is not ${/^[AEIOU]/.test(label) ? "an" : "a"} ${label} account. Choose the correct tab.`);
  }
  loginFails.delete(key);
  const token = issueToken(acc.username);
  audit(acc, 'login', `Signed in from ${ip}`);
  save();
  ok(res, { token, user: publicStaff(acc) });
});

route('POST', '/api/logout', (req, res, { auth }) => {
  if (auth) { delete db.tokens[auth.token]; save(); }
  ok(res);
});
route('GET', '/api/me', (req, res, { auth }) => {
  if (!auth) return fail(res, 401, 'Not signed in');
  ok(res, { user: publicStaff(auth.acc) });
});
route('POST', '/api/me/password', (req, res, { auth, body }) => {
  if (!auth) return fail(res, 401, 'Not signed in');
  const np = String(body.newPassword || '');
  if (!checkPassword(body.oldPassword || '', auth.acc.pw)) return fail(res, 400, 'Current password is incorrect.');
  if (np.length < 8) return fail(res, 400, 'New password must be at least 8 characters.');
  auth.acc.pw = hashPassword(np);
  audit(auth.acc, 'password-change', 'Changed own password');
  save();
  ok(res);
});
route('POST', '/api/me/email', (req, res, { auth, body }) => {
  if (!auth) return fail(res, 401, 'Not signed in');
  const email = clean(body.email, 120).toLowerCase();
  if (email && !isEmail(email)) return fail(res, 400, 'Enter a valid e-mail address.');
  auth.acc.email = email;
  audit(auth.acc, 'email-change', email ? maskEmail(email) : 'removed');
  save();
  ok(res, { user: publicStaff(auth.acc) });
});

// ----- forgot password: OTP by e-mail -----
// Effective SMTP settings: env vars / smtp.config.json win over the settings screen.
const smtpConfig = () => externalSmtp() || { ...(db.smtp || {}), source: 'settings screen' };

async function deliverOtp(acc, otp) {
  const cfg = smtpConfig();
  const subject = `UU Bus ERP password reset OTP: ${otp}`;
  const text = `Hello ${displayName(acc)},\n\nYour one-time password (OTP) to reset your UU Bus ERP password is: ${otp}\n\nIt is valid for 10 minutes. If you did not request this, ignore this e-mail.\n\n— United University Transport Department`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e3e7f2;border-radius:12px;overflow:hidden"><div style="background:#0d2c8c;color:#fff;padding:16px 20px;font-size:18px;font-weight:bold">United University · Bus ERP</div><div style="padding:20px"><p>Hello ${displayName(acc).replace(/</g, '')},</p><p>Your OTP to reset your password is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0d2c8c;margin:10px 0">${otp}</p><p style="color:#646b8a">Valid for 10 minutes. If you did not request this, ignore this e-mail.</p></div></div>`;
  if (!cfg.host || !cfg.user) {
    console.log(`\n[PASSWORD RESET] E-mail is not configured. OTP for ${acc.username} (${acc.email}): ${otp}\n`);
    return { dev: true };
  }
  await sendMail(cfg, { to: acc.email, subject, text, html });
  return { dev: false };
}
route('POST', '/api/forgot', async (req, res, { body, ip }) => {
  const id = clean(body.id, 60);
  if (!id) return fail(res, 400, 'Enter your login ID.');
  if (limited(`forgot|${ip}`, 10, 15 * 60 * 1000)) return fail(res, 429, 'Too many requests. Try again later.');
  const acc = findStaff(id);
  if (!acc || acc.active === false) return fail(res, 404, 'No account found with this login ID.');
  if (!acc.email) return fail(res, 400, 'No e-mail address is saved for this account. Ask the Super Admin to add your e-mail or reset your password.');
  const prev = db.resets[acc.username];
  if (prev && Date.now() - prev.sentAt < 60 * 1000) return fail(res, 429, 'An OTP was sent less than a minute ago. Please check your e-mail.');
  const otp = genOtp();
  db.resets[acc.username] = { hash: hashPassword(otp), sentAt: Date.now(), exp: Date.now() + 10 * 60 * 1000, tries: 0 };
  save();
  try {
    const r = await deliverOtp(acc, otp);
    audit(acc, 'password-reset-otp', `OTP sent to ${maskEmail(acc.email)}`);
    ok(res, { sentTo: maskEmail(acc.email), dev: r.dev });
  } catch (e) {
    delete db.resets[acc.username];
    console.error('Mail error:', e.message, '| Hint:', explainSmtpError(e.message));
    fail(res, 502, 'Could not send the e-mail. Ask the Super Admin to check the e-mail settings.');
  }
});
route('POST', '/api/forgot/verify', (req, res, { body }) => {
  const acc = findStaff(clean(body.id, 60));
  const r = acc && db.resets[acc.username];
  if (!r || r.exp < Date.now()) return fail(res, 400, 'OTP expired or not requested. Request a new OTP.');
  if (r.tries >= 5) { delete db.resets[acc.username]; save(); return fail(res, 429, 'Too many wrong attempts. Request a new OTP.'); }
  if (!checkPassword(String(body.otp || '').replace(/\D/g, ''), r.hash)) { r.tries++; save(); return fail(res, 400, `Wrong OTP. ${5 - r.tries} attempts left.`); }
  const np = String(body.newPassword || '');
  if (np.length < 8) return fail(res, 400, 'New password must be at least 8 characters.');
  acc.pw = hashPassword(np);
  delete db.resets[acc.username];
  revokeTokens(acc.username);
  audit(acc, 'password-reset', 'Password reset with e-mail OTP');
  save();
  ok(res);
});

// ======== COORDINATOR — counts only ========
route('GET', '/api/coord/summary', (req, res, { auth, query }) => {
  if (!auth || auth.role !== 'coordinator') return fail(res, 403, 'Coordinators only');
  const bus = auth.acc.bus;
  const total = busStudents(bus).length;
  const r = rangeFrom(query.range, '7d');
  const held = [...heldKeys(bus, r.from, r.to)];
  const ids = new Set(busStudents(bus).map((s) => s.enroll));
  const recs = db.attendance.filter((a) => a.bus === bus && a.date >= r.from && a.date <= r.to && ids.has(a.enroll));
  const avg = held.length ? recs.length / held.length : 0;
  const s = activeSession(bus);
  const days = datesBetween(r.from, r.to);
  const daily = days.map((d) => ({ date: d, Morning: recs.filter((x) => x.date === d && x.trip === 'Morning').length, Evening: recs.filter((x) => x.date === d && x.trip === 'Evening').length }));
  const today = fmtDate();
  ok(res, {
    bus, total, range: r.key, from: r.from, to: r.to,
    tripsHeld: held.length, totalMarked: recs.length,
    avgPresent: Math.round(avg * 10) / 10, avgPercent: total ? Math.round((avg / total) * 1000) / 10 : 0,
    today: { Morning: countFor(bus, today, 'Morning'), Evening: countFor(bus, today, 'Evening') },
    session: s ? { open: true, trip: s.trip, expiresAt: s.expiresAt, createdAt: s.createdAt, marked: countFor(bus, s.date, s.trip), serverNow: new Date().toISOString() } : { open: false },
    daily: daily.length > 31 ? null : daily,
  });
});

// ======== ADMIN (super / transport / bus incharge) ========
function requireAdmin(auth, res, bus) {
  if (!auth || !ADMIN_ROLES.includes(auth.role)) { fail(res, 403, 'Administrative admins only'); return false; }
  if (bus !== undefined && !canAdminBus(auth, bus)) { fail(res, 403, `You cannot manage bus ${bus}.`); return false; }
  return true;
}
function requireSuper(auth, res) {
  if (!auth || auth.role !== 'super') { fail(res, 403, 'Super Admin only'); return false; }
  return true;
}

route('GET', '/api/admin/live', (req, res, { auth, query }) => {
  const bus = query.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const open = activeSession(bus);
  const work = workingSession(bus);
  const ctx = work || null;
  const date = ctx ? ctx.date : fmtDate();
  const trip = ctx ? ctx.trip : (TRIPS.includes(query.trip) ? query.trip : defaultTrip());
  const r = rangeFrom('1m');
  const held = heldKeys(bus, r.from, r.to).size;
  const counts = {};
  db.attendance.filter((a) => a.bus === bus && a.date >= r.from).forEach((a) => (counts[a.enroll] = (counts[a.enroll] || 0) + 1));
  const list = busStudents(bus).map((st) => {
    const rec = findRecord(st.enroll, date, trip);
    return {
      enroll: st.enroll, name: st.name, stop: st.stop, course: academicInfo(st).course,
      marked: !!rec, time: rec?.time || null, method: rec?.method || null, markedBy: rec?.markedBy || null,
      pct30: held ? Math.round(((counts[st.enroll] || 0) / held) * 100) : null,
    };
  });
  const unread = db.chats.filter((c) => c.bus === bus && c.from === 'student' && !c.readByStaff).length;
  ok(res, {
    session: sessionView(open, true), working: sessionView(ctx, false),
    canManual: !!ctx && Date.now() <= manualUntil(ctx),
    date, trip, students: list, marked: list.filter((x) => x.marked).length, total: list.length,
    settings: db.settings[bus] || { otpMinutes: 10 }, unreadChats: unread, me: auth.acc.username,
  });
});

route('POST', '/api/admin/session/start', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const existing = activeSession(bus);
  if (existing) {
    const by = existing.createdBy === auth.acc.username ? 'you' : existing.createdByName;
    return fail(res, 409, `OTP is already being generated by ${by}.`, { code: 'BUSY', by, byRole: existing.createdByRole });
  }
  const trip = TRIPS.includes(body.trip) ? body.trip : defaultTrip();
  let minutes = Math.round(Number(body.minutes) || db.settings[bus]?.otpMinutes || 10);
  minutes = Math.min(MAX_OTP_MINUTES, Math.max(1, minutes));
  const now = new Date();
  const s = {
    id: uid(8), bus, trip, date: fmtDate(now), otp: genOtp(),
    createdBy: auth.acc.username, createdByName: displayWho(auth.acc), createdByRole: auth.role,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + minutes * 60000).toISOString(),
    closedAt: null, attempts: {}, devices: {}, ipFails: {},
  };
  db.sessions.push(s);
  audit(auth.acc, 'otp-generate', `${trip} trip, OTP valid ${minutes} min`, bus);
  save();
  ok(res, { session: sessionView(s, true) });
});

route('POST', '/api/admin/session/extend', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const s = activeSession(bus);
  if (!s) return fail(res, 409, 'No open attendance portal.');
  const minutes = Math.min(120, Math.max(1, Math.round(Number(body.minutes) || 5)));
  s.expiresAt = new Date(new Date(s.expiresAt).getTime() + minutes * 60000).toISOString();
  audit(auth.acc, 'otp-extend', `+${minutes} min`, bus);
  save();
  ok(res, { session: sessionView(s, true) });
});
route('POST', '/api/admin/session/regenerate', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const s = activeSession(bus);
  if (!s) return fail(res, 409, 'No open attendance portal.');
  s.otp = genOtp();
  audit(auth.acc, 'otp-regenerate', 'New OTP for the open portal', bus);
  save();
  ok(res, { session: sessionView(s, true) });
});
route('POST', '/api/admin/session/close', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const s = activeSession(bus);
  if (!s) return fail(res, 409, 'No open attendance portal.');
  s.closedAt = new Date().toISOString();
  s.closedReason = 'closed by ' + displayName(auth.acc);
  audit(auth.acc, 'portal-close', `${s.trip} trip closed manually (${countFor(bus, s.date, s.trip)} marked)`, bus);
  save();
  ok(res);
});
route('POST', '/api/admin/settings', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const m = Math.round(Number(body.otpMinutes));
  if (!(m >= 1 && m <= MAX_OTP_MINUTES)) return fail(res, 400, `OTP validity must be between 1 and ${MAX_OTP_MINUTES} minutes.`);
  db.settings[bus] = { ...(db.settings[bus] || {}), otpMinutes: m };
  audit(auth.acc, 'settings', `Default OTP validity ${m} min`, bus);
  save();
  ok(res, { settings: db.settings[bus] });
});

// Manual marking: only for the open session or within 1 hour after it closed. Never deletable.
route('POST', '/api/admin/mark', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const st = db.students.find((s) => s.enroll === body.enroll && s.bus === bus && s.active !== false);
  if (!st) return fail(res, 404, 'Student not found on this bus.');
  const s = db.sessions.find((x) => x.id === body.sessionId && x.bus === bus) || workingSession(bus);
  if (!s) return fail(res, 409, 'Manual marking is allowed only while the portal is open or within 1 hour after the OTP expires.');
  if (Date.now() > manualUntil(s)) return fail(res, 409, 'The 1-hour manual marking window for this trip is over. The student remains absent.');
  if (findRecord(st.enroll, s.date, s.trip)) return fail(res, 409, `${st.name} is already marked for the ${s.trip} trip.`);
  const now = new Date();
  const reason = clean(body.reason, 120);
  db.attendance.push({
    id: uid(8), sessionId: s.id, bus, enroll: st.enroll, date: s.date, trip: s.trip,
    time: fmtTime(now), at: now.toISOString(), method: 'ADMIN', markedBy: displayWho(auth.acc), reason,
  });
  audit(auth.acc, 'manual-mark', `${st.name} (${st.enroll}) — ${s.trip} ${s.date}${reason ? ' — ' + reason : ''}`, bus);
  save();
  ok(res);
});

route('GET', '/api/admin/students', (req, res, { auth, query }) => {
  const bus = query.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const r = rangeFrom(query.range, '1m');
  const held = heldKeys(bus, r.from, r.to).size;
  const counts = {};
  db.attendance.filter((a) => a.bus === bus && a.date >= r.from && a.date <= r.to).forEach((a) => (counts[a.enroll] = (counts[a.enroll] || 0) + 1));
  const today = fmtDate();
  ok(res, {
    range: r.key, held,
    stops: (db.stops[bus] || []).map((s) => s.name),
    canEdit: auth.role === 'super',
    students: busStudents(bus).map((s) => ({
      ...studentCard(s), present: counts[s.enroll] || 0,
      pct: held ? Math.round(((counts[s.enroll] || 0) / held) * 100) : null,
      todayMorning: !!findRecord(s.enroll, today, 'Morning'), todayEvening: !!findRecord(s.enroll, today, 'Evening'),
    })),
  });
});

function buildReport(bus, from, to, trip) {
  const byEnroll = Object.fromEntries(db.students.map((s) => [s.enroll, s]));
  const recs = db.attendance
    .filter((a) => a.bus === bus && a.date >= from && a.date <= to && (!trip || a.trip === trip))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { byEnroll, recs };
}
const markedByLabel = (r) => (r.method === 'SELF' ? 'Student (self, OTP)' : `Admin: ${r.markedBy}`);

route('GET', '/api/admin/report', (req, res, { auth, query }) => {
  const bus = query.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const to = isDate(query.to) ? query.to : fmtDate();
  const from = isDate(query.from) ? query.from : addDays(to, -6);
  if (from > to) return fail(res, 400, '"From" date must be before "To" date.');
  if (from < addDays(fmtDate(), -184)) return fail(res, 400, 'Reports are limited to the last 6 months.');
  const trip = TRIPS.includes(query.trip) ? query.trip : '';
  const { byEnroll, recs } = buildReport(bus, from, to, trip);
  const days = datesBetween(from, to);
  ok(res, {
    from, to, trip, total: busStudents(bus).length,
    tripsHeld: [...heldKeys(bus, from, to)].filter((k) => !trip || k.endsWith(trip)).length,
    daily: days.length <= 62 ? days.map((d) => ({ date: d, Morning: recs.filter((r) => r.date === d && r.trip === 'Morning').length, Evening: recs.filter((r) => r.date === d && r.trip === 'Evening').length })) : null,
    records: recs.slice(-500).reverse().map((r) => ({ date: r.date, time: r.time, trip: r.trip, enroll: r.enroll, name: byEnroll[r.enroll]?.name || r.enroll, stop: byEnroll[r.enroll]?.stop || '', method: r.method, markedBy: markedByLabel(r) })),
    count: recs.length,
  });
});

route('GET', '/api/admin/export', (req, res, { auth, query }) => {
  const bus = query.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const to = isDate(query.to) ? query.to : fmtDate();
  const from = isDate(query.from) ? query.from : addDays(to, -29);
  if (from > to) return fail(res, 400, '"From" date must be before "To" date.');
  if (from < addDays(fmtDate(), -184)) return fail(res, 400, 'Exports are limited to the last 6 months.');
  const trip = TRIPS.includes(query.trip) ? query.trip : '';
  const { byEnroll, recs } = buildReport(bus, from, to, trip);
  const studs = busStudents(bus);

  const log = [['S.No.', 'Student Name', 'Enrollment No.', 'Date', 'Day', 'Time', 'Trip', 'Marked By', 'Marking Type', 'Pickup / Route Point', 'Programme', 'Remarks']];
  recs.forEach((r, i) => {
    const st = byEnroll[r.enroll] || {};
    const day = new Date(r.date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
    log.push([i + 1, st.name || r.enroll, r.enroll, r.date, day, r.time, r.trip, r.method === 'SELF' ? `${st.name || ''} (self)` : r.markedBy, r.method === 'SELF' ? 'Student marked own attendance (OTP)' : 'Marked manually by admin', st.stop || '', st.programme || '', r.reason || '']);
  });

  const held = new Set([...heldKeys(bus, from, to)].filter((k) => !trip || k.endsWith(trip)));
  recs.forEach((r) => held.add(`${r.date}|${r.trip}`));
  const cols = [...held].sort().map((k) => { const [d, t] = k.split('|'); return { d, t }; });
  const marked = new Map(recs.map((r) => [`${r.enroll}|${r.date}|${r.trip}`, r]));
  const reg = [['S.No.', 'Student Name', 'Enrollment No.', 'Pickup Point', ...cols.map((c) => `${c.d.slice(5)} ${c.t[0]}`), 'Present', 'Absent', 'Total', '%']];
  studs.forEach((s, i) => {
    const marks = cols.map((c) => (marked.has(`${s.enroll}|${c.d}|${c.t}`) ? 'P' : 'A'));
    const p = marks.filter((m) => m === 'P').length;
    reg.push([i + 1, s.name, s.enroll, s.stop, ...marks, p, cols.length - p, cols.length, cols.length ? Math.round((p / cols.length) * 1000) / 10 : 0]);
  });

  const summary = [['Date', 'Trip', 'Present', 'Self (OTP)', 'By Admin', 'Absent', 'Total Students', 'Attendance %']];
  cols.forEach((c) => {
    const day = recs.filter((r) => r.date === c.d && r.trip === c.t);
    const self = day.filter((r) => r.method === 'SELF').length;
    summary.push([c.d, c.t, day.length, self, day.length - self, studs.length - day.length, studs.length, studs.length ? Math.round((day.length / studs.length) * 1000) / 10 : 0]);
  });

  const info = [
    ['United University — Bus Attendance Report'], [],
    ['Bus', bus], ['Period', `${from} to ${to}`], ['Trip', trip || 'Morning + Evening'],
    ['Total students', studs.length], ['Trips held', cols.length], ['Attendance records', recs.length],
    ['Generated by', displayWho(auth.acc)], ['Generated at', `${fmtDate()} ${fmtTime()} IST`],
  ];

  const buf = buildXlsx([
    { name: 'Attendance', rows: log, widths: [7, 26, 16, 12, 7, 10, 10, 36, 34, 32, 34, 22] },
    { name: 'Register (P-A)', rows: reg, widths: [7, 26, 16, 30, ...cols.map(() => 9), 9, 9, 7, 7], markPA: true },
    { name: 'Daily Summary', rows: summary, widths: [12, 10, 10, 11, 10, 10, 15, 14] },
    { name: 'Report Info', rows: info, widths: [22, 50], headerRow: -1, styles: { '0,0': 4 } },
  ]);
  audit(auth.acc, 'export', `Excel ${from}..${to} ${trip || 'all trips'} (${recs.length} records)`, bus);
  save();
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${bus}_attendance_${from}_to_${to}.xlsx"`,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
});

// ----- chats (admin side) -----
route('GET', '/api/admin/chats', (req, res, { auth, query }) => {
  const bus = query.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const threads = {};
  db.chats.filter((c) => c.bus === bus).forEach((c) => {
    const t = (threads[c.enroll] = threads[c.enroll] || { enroll: c.enroll, unread: 0, last: null });
    if (c.from === 'student' && !c.readByStaff) t.unread++;
    t.last = c;
  });
  const byEnroll = Object.fromEntries(db.students.map((s) => [s.enroll, s]));
  ok(res, {
    threads: Object.values(threads)
      .sort((a, b) => b.last.at.localeCompare(a.last.at))
      .map((t) => ({ enroll: t.enroll, name: byEnroll[t.enroll]?.name || t.enroll, stop: byEnroll[t.enroll]?.stop || '', unread: t.unread, lastAt: t.last.at, lastFrom: t.last.from, preview: t.last.type === 'voice' ? '🎤 Voice message' : t.last.text.slice(0, 80) })),
  });
});
route('GET', '/api/admin/chat', (req, res, { auth, query }) => {
  const bus = query.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const msgs = db.chats.filter((c) => c.bus === bus && c.enroll === query.enroll);
  let changed = false;
  msgs.forEach((c) => { if (c.from === 'student' && !c.readByStaff) { c.readByStaff = true; changed = true; } });
  if (changed) save();
  const st = db.students.find((s) => s.enroll === query.enroll);
  ok(res, { student: st ? studentCard(st) : { enroll: query.enroll, name: query.enroll }, messages: msgs.slice(-300).map(chatView) });
});
route('POST', '/api/admin/chat', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const st = db.students.find((s) => s.enroll === body.enroll);
  if (!st) return fail(res, 404, 'Student not found');
  const text = clean(body.text, 1000);
  if (!text) return fail(res, 400, 'Type a reply');
  const msg = { id: uid(8), bus, enroll: st.enroll, from: 'staff', staffName: displayWho(auth.acc), type: 'text', text, at: new Date().toISOString(), readByStudent: false };
  db.chats.push(msg);
  save();
  ok(res, { message: chatView(msg) });
});

// ----- notices / stops / bus info -----
route('POST', '/api/admin/notice', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const title = clean(body.title, 100);
  const text = clean(body.body, 1000);
  if (!title || !text) return fail(res, 400, 'Title and message are required.');
  const toAll = body.allBuses && (auth.role === 'super' || auth.role === 'transport');
  db.notices.push({ id: uid(6), bus: toAll ? '*' : bus, title, body: text, pinned: !!body.pinned, by: auth.role === 'super' ? 'Super Admin' : auth.acc.title, at: new Date().toISOString() });
  audit(auth.acc, 'notice-post', title, bus);
  save();
  ok(res);
});
route('POST', '/api/admin/notice/remove', (req, res, { auth, body }) => {
  const n = db.notices.find((x) => x.id === body.id);
  if (!n) return fail(res, 404, 'Notice not found');
  if (n.bus === '*' ? !(auth && (auth.role === 'super' || auth.role === 'transport')) : !canAdminBus(auth, n.bus)) return fail(res, 403, 'Not allowed');
  db.notices = db.notices.filter((x) => x.id !== n.id);
  audit(auth.acc, 'notice-remove', n.title, n.bus);
  save();
  ok(res);
});
route('POST', '/api/admin/stops', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  if (!Array.isArray(body.stops) || body.stops.length > 60) return fail(res, 400, 'Invalid stops list');
  const stops = body.stops.map((s) => ({ id: clean(s.id, 12) || uid(4), name: clean(s.name, 80), time: clean(s.time, 5) })).filter((s) => s.name);
  const old = db.stops[bus] || [];
  for (const s of stops) {
    const prev = old.find((o) => o.id === s.id);
    if (prev && prev.name !== s.name) db.students.forEach((st) => { if (st.bus === bus && st.stop === prev.name) st.stop = s.name; });
  }
  db.stops[bus] = stops;
  audit(auth.acc, 'stops-update', `${stops.length} stops`, bus);
  save();
  ok(res);
});
route('POST', '/api/admin/bus', (req, res, { auth, body }) => {
  const bus = body.bus;
  if (!requireAdmin(auth, res, bus)) return;
  const b = db.buses.find((x) => x.id === bus);
  Object.assign(b, { route: clean(body.route, 120), driver: clean(body.driver, 60), driverPhone: clean(body.driverPhone, 20), vehicleNo: clean(body.vehicleNo, 20) });
  audit(auth.acc, 'bus-update', 'Route/driver details', bus);
  save();
  ok(res);
});
route('GET', '/api/admin/audit', (req, res, { auth, query }) => {
  const bus = query.bus;
  if (!requireAdmin(auth, res, bus)) return;
  ok(res, { audit: db.audit.filter((a) => a.bus === bus || (auth.role === 'super' && a.bus === '*')).slice(-300).reverse() });
});

// ======== SUPER ADMIN ========
route('POST', '/api/super/students/save', (req, res, { auth, body }) => {
  if (!requireSuper(auth, res)) return;
  const bus = body.bus;
  if (!BUSES.includes(bus)) return fail(res, 400, 'Select a bus');
  const enroll = clean(body.enroll, 30).toUpperCase();
  const name = clean(body.name, 80);
  if (!/^[A-Z0-9]{4,30}$/.test(enroll)) return fail(res, 400, 'Enrollment number should be letters/digits only.');
  if (!name) return fail(res, 400, 'Name is required.');
  const fields = {
    name, programme: clean(body.programme, 80) || '—', stop: clean(body.stop, 80), phone: clean(body.phone, 20),
    deptOverride: clean(body.department, 60), yearOverride: Number(body.year) || null, semOverride: Number(body.semester) || null,
  };
  let st = db.students.find((s) => s.enroll === enroll);
  if (st && body.isNew && st.active !== false) return fail(res, 409, `${enroll} already exists on bus ${st.bus}.`);
  if (st) {
    const from = st.bus;
    const wasRemoved = st.active === false;
    Object.assign(st, fields, { bus, active: true });
    audit(auth.acc, wasRemoved ? 'student-readd' : 'student-update', `${name} (${enroll})${from !== bus ? ` moved ${from} → ${bus}` : ''}`, bus);
  } else {
    st = { enroll, ...fields, bus, active: true };
    db.students.push(st);
    audit(auth.acc, 'student-add', `${name} (${enroll}) added to ${bus}`, bus);
  }
  save();
  ok(res);
});
route('POST', '/api/super/students/remove', (req, res, { auth, body }) => {
  if (!requireSuper(auth, res)) return;
  const st = db.students.find((s) => s.enroll === body.enroll && s.active !== false);
  if (!st) return fail(res, 404, 'Student not found');
  st.active = false;
  st.removedAt = new Date().toISOString();
  audit(auth.acc, 'student-remove', `${st.name} (${st.enroll}) removed from ${st.bus}`, st.bus);
  save();
  ok(res);
});
route('GET', '/api/super/staff', (req, res, { auth }) => {
  if (!requireSuper(auth, res)) return;
  ok(res, { staff: db.staff.map((s) => ({ ...publicStaff(s), active: s.active !== false, self: s.username === auth.acc.username })) });
});
route('POST', '/api/super/staff/save', (req, res, { auth, body }) => {
  if (!requireSuper(auth, res)) return;
  const role = ['busincharge', 'transport', 'coordinator'].includes(body.role) ? body.role : null;
  if (!role) return fail(res, 400, 'Invalid role');
  const bus = role === 'transport' ? '*' : body.bus;
  if (role !== 'transport' && !BUSES.includes(bus)) return fail(res, 400, 'Select a bus');
  const name = clean(body.name, 80);
  if (!name) return fail(res, 400, 'Name is required');
  const email = clean(body.email, 120).toLowerCase();
  if (email && !isEmail(email)) return fail(res, 400, 'Invalid e-mail');
  const titles = { transport: 'Transport Incharge', busincharge: 'Bus Incharge', coordinator: 'Student Coordinator' };
  const fields = { name, role, bus, phone: clean(body.phone, 20), email, title: clean(body.title, 60) || titles[role], active: body.active !== false };
  let s = body.username ? findStaff(body.username) : null;
  if (s && s.role === 'super') return fail(res, 400, 'The Super Admin account cannot be edited here.');
  let password = null;
  if (s) {
    Object.assign(s, fields);
    if (!fields.active) revokeTokens(s.username);
  } else {
    const taken = new Set(db.staff.map((x) => x.username));
    const username = uniqueId(role === 'coordinator' ? 'UUSC' : 'UUAD', taken);
    password = randomPassword();
    s = { username, ...fields, pw: hashPassword(password) };
    db.staff.push(s);
  }
  audit(auth.acc, 'staff-save', `${s.username} — ${fields.title} (${bus === '*' ? 'all buses' : bus})${fields.active ? '' : ' deactivated'}`, bus);
  save();
  ok(res, { username: s.username, password });
});
route('POST', '/api/super/staff/reset', (req, res, { auth, body }) => {
  if (!requireSuper(auth, res)) return;
  const s = findStaff(body.username);
  if (!s || s.role === 'super') return fail(res, 404, 'Not found');
  const password = randomPassword();
  s.pw = hashPassword(password);
  revokeTokens(s.username);
  audit(auth.acc, 'staff-password-reset', s.username, s.bus);
  save();
  ok(res, { username: s.username, password });
});
route('GET', '/api/super/smtp', (req, res, { auth }) => {
  if (!requireSuper(auth, res)) return;
  const ext = externalSmtp();
  const c = ext || db.smtp || {};
  ok(res, { host: c.host || '', port: c.port || 465, user: c.user || '', from: c.from || '', hasPass: !!c.pass, locked: !!ext, source: ext ? ext.source : 'settings screen' });
});
route('POST', '/api/super/smtp', async (req, res, { auth, body }) => {
  if (!requireSuper(auth, res)) return;
  if (externalSmtp() && !body.testOnly) return fail(res, 409, 'E-mail is configured in smtp.config.json on the server. Edit that file instead.');
  const c = db.smtp || {};
  if (!body.testOnly) db.smtp = { host: clean(body.host, 120), port: Number(body.port) || 465, user: clean(body.user, 120), pass: body.pass ? String(body.pass) : c.pass || '', from: clean(body.from, 160) };
  if (!body.testOnly) { audit(auth.acc, 'smtp-update', db.smtp.host); save(); }
  if (body.testTo) {
    if (!isEmail(body.testTo)) return fail(res, 400, 'Invalid test e-mail address');
    try {
      await sendMail(smtpConfig(), { to: body.testTo, subject: 'UU Bus ERP — test e-mail', text: 'E-mail delivery for password reset OTPs is working.' });
    } catch (e) { return fail(res, 502, 'Test e-mail failed: ' + explainSmtpError(e.message)); }
    return ok(res, { tested: true });
  }
  ok(res);
});

// ---------- server ----------
loadDb();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const vm = req.method === 'GET' && pathname.match(/^\/api\/voice\/([a-f0-9]{24})$/);
  if (vm) {
    const msg = db.chats.find((c) => c.voiceId === vm[1]);
    if (!msg) return fail(res, 404, 'Not found');
    return fs.readFile(path.join(VOICE_DIR, `${msg.voiceId}.${msg.voiceExt}`), (err, buf) => {
      if (err) return fail(res, 404, 'Not found');
      res.writeHead(200, { 'Content-Type': msg.voiceMime, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
      res.end(buf);
    });
  }

  const r = routes[`${req.method} ${pathname}`];
  if (!r) return fail(res, 404, 'Unknown endpoint');
  try {
    const body = req.method === 'POST' ? await readBody(req, r.limit || 1e6) : {};
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    await r.fn(req, res, { body, query: Object.fromEntries(url.searchParams), auth: authFromReq(req), ip });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 400, e.message || 'Request failed');
  }
});
server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  UU Bus ERP running`);
  const mail = smtpConfig();
  console.log(mail.host && mail.user ? `  E-mail:  OTPs sent via ${mail.host} as ${mail.user} (from ${mail.source})` : '  E-mail:  NOT configured - reset OTPs will print here. Fill in smtp.config.json');
  console.log(`  Local:   http://localhost:${PORT}`);
  lan.forEach((a) => console.log(`  Network: http://${a}:${PORT}   (phones on the same Wi-Fi)`));
  console.log('');
});
function shutdown() { try { saveNow(); } catch {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
