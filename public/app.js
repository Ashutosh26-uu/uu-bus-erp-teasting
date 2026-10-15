/* United University — Bus ERP frontend (vanilla JS SPA) */
(() => {
  'use strict';

  // ---------- storage (guarded) ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('uubus.' + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('uubus.' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('uubus.' + k); } catch {} },
  };
  let deviceId = store.get('device');
  if (!deviceId) {
    deviceId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '');
    store.set('device', deviceId);
  }

  const S = {
    view: 'home', // home | pick | student | login | staff
    bus: null,
    me: store.get('me'), // remembered student {bus, enroll, name}
    student: null,
    token: store.get('token'),
    user: null,
    adminBus: store.get('adminBus') || 'UU-10',
    tab: null,
    offset: 0,
    loginMode: 'admin',
    live: { filter: 'all', q: '', trip: null, lastSessionId: undefined },
    stuRange: '1m',
    histRange: '7d',
    coordRange: '7d',
    report: null,
    chatWith: null,
  };

  // ---------- utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => String(n).replace(/\(.*?\)/g, '').replace(/^(Mr|Mrs|Ms|Dr)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const isAdmin = () => S.user && ['super', 'transport', 'busincharge'].includes(S.user.role);
  const isSuper = () => S.user && S.user.role === 'super';
  const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const niceDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short', timeZone: 'UTC' });
  const shortDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const when = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
  const serverNow = () => Date.now() + S.offset;
  const syncClock = (iso) => { if (iso) S.offset = new Date(iso).getTime() - Date.now(); };
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  function greeting() {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
    if (h < 12) return { text: 'Good morning', icon: '🌅' };
    if (h < 17) return { text: 'Good afternoon', icon: '☀️' };
    return { text: 'Good evening', icon: '🌙' };
  }
  const RANGE_LABELS = { '1d': '1 day', '7d': '7 days', '1m': '1 month', '3m': '3 months', '6m': '6 months' };

  const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    bus: svg('<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r="1"/><circle cx="16" cy="14.5" r="1"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>', 2.6),
    lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    msg: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>'),
    bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    users: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'),
    chart: svg('<path d="M3 3v18h18"/><path d="M8 17V11M13 17V7M18 17v-4"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
    live: svg('<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>'),
    logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
    back: svg('<path d="m15 18-6-6 6-6"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>', 2.4),
    refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>'),
    pin: svg('<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>'),
    shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>'),
    mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/>'),
    send: svg('<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    route: svg('<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12"/>'),
    mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>'),
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>',
    moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    radio: svg('<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>'),
  };

  // ---------- theme (light / dark) ----------
  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const themeBtn = (extra = '') => `<button class="icon-btn theme-btn ${extra}" data-theme-toggle title="${isDark() ? 'Light mode' : 'Dark mode'}" aria-label="Toggle dark mode">${isDark() ? I.sun : I.moon}</button>`;
  function toggleTheme() {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
    $('meta[name=theme-color]').setAttribute('content', next === 'dark' ? '#0b1020' : '#0d2c8c');
    $$('[data-theme-toggle]').forEach((b) => { b.innerHTML = next === 'dark' ? I.sun : I.moon; b.title = next === 'dark' ? 'Light mode' : 'Dark mode'; });
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-theme-toggle]')) toggleTheme(); });

  // WhatsApp message for a live OTP (uses WhatsApp *bold* formatting)
  function otpShareMessage(s, bus) {
    const mins = Math.max(1, Math.round((new Date(s.expiresAt).getTime() - serverNow()) / 60000));
    const by = S.user && S.user.role === 'super' ? 'Super Admin' : `${S.user.title} — ${S.user.name}`;
    return [
      `🚌 *United University — Bus ${bus}*`,
      `✅ *${s.trip} trip attendance is LIVE now*`,
      '',
      `🔑 OTP: *${s.otp}*`,
      `⏰ Valid till *${clock(s.expiresAt)}* (about ${mins} min)`,
      `📅 ${niceDate(s.date)}`,
      '',
      'How to mark your attendance:',
      `1️⃣ Open ${location.origin}`,
      `2️⃣ Select bus *${bus}* and tap your name`,
      '3️⃣ Enter the OTP and tap *Mark my attendance*',
      '',
      '⚠️ Please mark only your own attendance, from your own phone. The portal closes automatically when the time is over.',
      '',
      `— ${by}`,
    ].join('\n');
  }

  const footer = () => `<footer class="site-footer">
      © United University, Prayagraj · Transport Department
      <span class="dev">Developed by <a href="https://reasonateai.com/" target="_blank" rel="noopener noreferrer">ReasonateAI</a> under the guidance of Mr. Manish Shukla, CSE Department, United University</span>
    </footer>`;

  // ---------- API ----------
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && S.user && !url.startsWith('/api/public')) { staffLogout(true); throw new Error('Session expired. Please sign in again.'); }
    if (!res.ok) { const e = new Error(data.error || 'Request failed (' + res.status + ')'); Object.assign(e, data, { status: res.status }); e.message = data.error || e.message; throw e; }
    return data;
  }
  const get = (u) => api('GET', u);
  const post = (u, b) => api('POST', u, b || {});
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  // ---------- UI helpers ----------
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }
  function modal(html, onMount, opts = {}) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-back"><div class="modal ${opts.cls || ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    const back = $('.modal-back', root);
    const close = () => { if (back.isConnected) root.innerHTML = ''; };
    if (!opts.sticky) back.addEventListener('click', (e) => { if (e.target === back) close(); });
    $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
    onMount && onMount($('.modal', root), close);
    return close;
  }
  // 5-second auto-closing popup (used when another admin is generating the OTP)
  function popup5(title, text) {
    const close = modal(`<div class="popup5"><div class="popup5-icon">${I.key}</div><h2>${esc(title)}</h2><p>${text}</p><div class="popup5-bar"><i></i></div><button class="btn outline sm" data-close>OK</button></div>`, null, { cls: 'narrow' });
    setTimeout(close, 5000);
  }
  function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
    return new Promise((resolve) => {
      modal(`<h2>${esc(title)}</h2><p class="muted">${text}</p><div class="btn-row mt"><button class="btn outline" data-close style="flex:1">Cancel</button><button class="btn ${danger ? 'red' : ''}" id="cf-ok" style="flex:1">${esc(okLabel)}</button></div>`, (m, close) => {
        $('#cf-ok', m).onclick = () => { close(); resolve(true); };
        $$('[data-close]', m).forEach((b) => b.addEventListener('click', () => resolve(false)));
      });
    });
  }
  async function busy(btn, fn) {
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Please wait…';
    try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
  }
  const chips = (id, options, active) => `<div class="chips" id="${id}">${options.map((o) => `<button class="chip ${o === active ? 'active' : ''}" data-v="${o}">${RANGE_LABELS[o] || o}</button>`).join('')}</div>`;
  const bindChips = (id, fn) => $$(`#${id} [data-v]`).forEach((b) => (b.onclick = () => { $$(`#${id} .chip`).forEach((c) => c.classList.toggle('active', c === b)); fn(b.dataset.v); }));
  function credsModal(title, username, password) {
    modal(`<h2>${esc(title)}</h2><p class="muted">Share these details only with the account owner. The password is shown once.</p>
      <div class="cred"><span>Login ID</span><b>${esc(username)}</b></div><div class="cred"><span>Password</span><b>${esc(password)}</b></div>
      <div class="btn-row mt"><button class="btn ghost" id="cp" style="flex:1">Copy</button><button class="btn" data-close style="flex:1">Done</button></div>`, (m) => {
      $('#cp', m).onclick = () => { navigator.clipboard?.writeText(`Login ID: ${username}\nPassword: ${password}`).then(() => toast('Copied', 'ok')).catch(() => toast('Copy failed', 'err')); };
    }, { sticky: true });
  }

  // timers: one poller + one 1s ticker
  let pollTimer = null;
  function setPoll(fn, ms) {
    clearInterval(pollTimer);
    pollTimer = null;
    if (fn) { fn(); pollTimer = setInterval(fn, ms); }
  }
  let expiredHandler = null;
  const onExpired = (fn) => (expiredHandler = fn);
  setInterval(() => {
    $$('[data-expires]').forEach((el) => {
      const exp = new Date(el.dataset.expires).getTime();
      const start = new Date(el.dataset.start || el.dataset.expires).getTime();
      const left = Math.max(0, exp - serverNow());
      const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
      const t = el.querySelector('.timer');
      if (t) t.textContent = (h ? `${h}:${String(m).padStart(2, '0')}` : m) + `:${String(s).padStart(2, '0')}`;
      const bar = el.querySelector('.timer-bar i');
      if (bar && exp > start) bar.style.width = Math.min(100, (left / (exp - start)) * 100) + '%';
      if (left === 0 && !el.dataset.done) { el.dataset.done = '1'; if (el.dataset.onexpire && expiredHandler) setTimeout(expiredHandler, 700); }
    });
  }, 1000);

  // ---------- router ----------
  // Student-side watcher: tells the student (with a popup) whether the attendance portal is live.
  let watchTimer = null;
  function portalPopup(kind, s) {
    const trip = esc(s?.trip || '');
    const cfg = {
      live: () => ({ icon: I.radio, title: 'Attendance portal is LIVE', text: `The ${trip} trip attendance is open${s.createdBy ? ` (OTP by ${esc(s.createdBy)})` : ''}. Enter the OTP announced in the bus.`, btn: 'Enter OTP now' }),
      closed: () => ({ icon: I.lock, title: 'Portal is not live', text: 'Attendance is closed right now. It opens when the bus incharge shares the OTP in the bus. A popup will appear here as soon as it goes live.', btn: 'OK' }),
      ended: () => ({ icon: I.lock, title: 'Portal closed', text: 'The attendance portal has just closed. If you missed it, contact your bus incharge.', btn: 'OK' }),
      done: () => ({ icon: I.check, title: 'Portal is live', text: `You are already marked present for the ${trip} trip.`, btn: 'OK' }),
    }[kind]();
    const close = modal(`<div class="portal-pop ${kind === 'ended' ? 'closed' : kind}">
        <div class="pp-icon">${cfg.icon}</div>
        <h2>${cfg.title}</h2>
        <p>${cfg.text}</p>
        ${kind === 'live' ? `<div class="pp-timer" data-expires="${s.expiresAt}" data-start="${s.createdAt}">Closes in <span class="timer">--:--</span></div>` : ''}
        <button class="btn ${kind === 'live' ? 'green' : 'outline'} block" id="pp-go">${kind === 'live' ? I.key + ' ' : ''}${cfg.btn}</button>
      </div>`, (m, c) => {
      $('#pp-go', m).onclick = () => {
        c();
        if (kind !== 'live') return;
        if (S.tab !== 'attend') { S.tab = 'attend'; render(); }
        setTimeout(() => { const i = $('#otp-one'); if (i && !i.disabled) i.focus(); }, 300);
      };
    }, { cls: 'narrow' });
    if (kind === 'live' && navigator.vibrate) navigator.vibrate([120, 60, 120]);
    if (kind !== 'live') setTimeout(close, 6000);
  }
  function startPortalWatch() {
    clearInterval(watchTimer);
    const check = async () => {
      if (S.view !== 'student' || !S.me) return;
      let d;
      try { d = await get('/api/public/student?' + qs({ enroll: S.me.enroll, bus: S.me.bus })); } catch { return; }
      const s = d.session;
      const state = s ? (s.alreadyMarked ? 'done' : 'live') : 'closed';
      const prev = S.portalSeen;
      S.portalSeen = state;
      if (prev === undefined) return portalPopup(state, s);
      if (prev === state) return;
      if (state === 'live') portalPopup('live', s);
      else if (state === 'closed' && prev === 'live') portalPopup('ended', s);
    };
    check();
    watchTimer = setInterval(check, 5000);
  }

  function go(view, extra = {}) {
    if (view !== 'student' || (extra.me && extra.me !== S.me)) S.portalSeen = undefined;
    Object.assign(S, extra, { view });
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    setPoll(null);
    clearInterval(watchTimer);
    stopRecording(true);
    expiredHandler = null;
    const app = $('#app');
    if (S.view === 'staff' && S.user) return renderStaff(app);
    if (S.view === 'login') return renderLogin(app);
    if (S.view === 'pick') return renderPick(app);
    if (S.view === 'student' && S.me) return renderStudent(app);
    S.view = 'home';
    return renderHome(app);
  }

  // ======================================================================
  // HOME (public)
  // ======================================================================
  async function renderHome(app) {
    const g = greeting();
    app.innerHTML = `
      <section class="hero home-hero">${themeBtn('hero-theme')}<div class="hero-inner col">
        <img src="/logo.png" alt="United University" class="home-logo">
        <div class="greet">${g.icon} ${g.text}, Student!</div>
        <p class="tagline" id="tagline">&nbsp;</p>
      </div></section>
      <main class="page lift">
        ${S.me ? `<button class="card continue" id="continue"><div class="avatar ok">${esc(initials(S.me.name))}</div><div class="li-main"><div class="s">Continue as</div><div class="t">${esc(S.me.name)}</div></div><span class="badge orange">${esc(S.me.bus)}</span></button>` : ''}
        <div class="card">
          <h2>Select your bus</h2>
          <p class="sub">Tap your bus number to open your attendance portal.</p>
          <div class="bus-grid" id="bus-grid">${Array.from({ length: 21 }, (_, i) => `<div class="bus-tile"><div class="n">UU-${i + 1}</div><div class="c">…</div></div>`).join('')}</div>
        </div>
        <div class="admin-entry">
          <span>Bus incharge, transport incharge, coordinator or super admin?</span>
          <button class="btn outline sm" id="to-login">${I.shield} Admin login</button>
        </div>
        ${footer()}
      </main>`;
    $('#to-login').onclick = () => go(S.user ? 'staff' : 'login');
    const cont = $('#continue');
    if (cont) cont.onclick = () => go('student', { bus: S.me.bus, tab: 'attend' });
    try {
      const d = await get('/api/public/home');
      $('#tagline').textContent = d.tagline;
      $('#bus-grid').innerHTML = d.buses.map((b) => `
        <button class="bus-tile ${b.students ? 'has' : ''}" data-bus="${b.id}">
          ${b.live ? '<span class="live" title="Attendance open"><span class="dot pulse"></span></span>' : ''}
          ${I.bus}<div class="n">${b.id}</div><div class="c">${b.students ? b.students + ' students' : 'No data yet'}</div>
        </button>`).join('');
      $$('[data-bus]').forEach((b) => (b.onclick = () => go('pick', { bus: b.dataset.bus })));
    } catch (e) {
      $('#bus-grid').innerHTML = `<div class="alert err" style="grid-column:1/-1">Cannot reach the server: ${esc(e.message)}</div>`;
    }
  }

  // ======================================================================
  // PICK NAME (public)
  // ======================================================================
  async function renderPick(app) {
    app.innerHTML = `
      <header class="topbar"><button class="icon-btn" id="back" aria-label="Back">${I.back}</button>
        <div class="grow"><div class="t1">Bus ${esc(S.bus)}</div><div class="t2">Find your name</div></div>${themeBtn()}<img class="logo" src="/logo.png" alt=""></header>
      <main class="page narrow">
        <div class="card">
          <h2>Who are you?</h2>
          <p class="sub">Type or select your name. Your enrollment number and details fill in automatically.</p>
          <div class="search"><span>${I.search}</span><input class="input" id="q" placeholder="Start typing your name…" autocomplete="off"></div>
          <div class="list mt" id="names"><p class="muted">Loading…</p></div>
        </div>
        ${footer()}
      </main>`;
    $('#back').onclick = () => go('home');
    let list = [];
    try { list = (await get('/api/public/roster?bus=' + encodeURIComponent(S.bus))).students; } catch (e) { $('#names').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
    const draw = () => {
      const q = $('#q').value.trim().toLowerCase();
      const f = list.filter((s) => !q || s.name.toLowerCase().includes(q) || s.enroll.toLowerCase().includes(q));
      $('#names').innerHTML = !list.length
        ? `<div class="empty">${I.users}<div>No students are registered on ${esc(S.bus)} yet.</div></div>`
        : f.length ? f.map((s) => `<button class="list-item pick" data-e="${esc(s.enroll)}"><div class="avatar">${esc(initials(s.name))}</div><div class="li-main"><div class="t">${esc(s.name)}</div><div class="s">${esc(s.stop)}</div></div><span class="chev">›</span></button>`).join('')
        : '<p class="muted center">No match. Check the spelling.</p>';
      $$('[data-e]').forEach((b) => (b.onclick = () => {
        const s = list.find((x) => x.enroll === b.dataset.e);
        S.me = { bus: S.bus, enroll: s.enroll, name: s.name };
        store.set('me', S.me);
        go('student', { tab: 'attend' });
      }));
    };
    $('#q').oninput = draw;
    $('#q').focus();
    draw();
  }

  // ======================================================================
  // STUDENT PORTAL (public)
  // ======================================================================
  function forgetMe(msg) {
    store.del('me');
    S.me = null;
    if (msg) toast(msg, 'err');
    go('home');
  }
  function handleStudentErr(e) {
    if (e.code === 'REMOVED') { forgetMe(e.message); return true; }
    if (e.code === 'MOVED') { S.me.bus = e.bus; store.set('me', S.me); toast(e.message); render(); return true; }
    return false;
  }
  function renderStudent(app) {
    S.tab = ['attend', 'history', 'chat', 'route'].includes(S.tab) ? S.tab : 'attend';
    const me = S.me;
    app.innerHTML = `
      <header class="topbar"><button class="icon-btn" id="back" aria-label="Home">${I.back}</button>
        <div class="grow"><div class="t1">${esc(me.name)}</div><div class="t2">${esc(me.enroll)} · Bus ${esc(me.bus)}</div></div>
        ${themeBtn()}<button class="btn sm ghost-w" id="notme">Not you?</button></header>
      <nav class="bottom-nav"><div class="inner">${[
        ['attend', 'Attendance', I.check], ['history', 'History', I.chart], ['chat', 'Chat', I.msg], ['route', 'Bus stops', I.route],
      ].map(([id, l, ic]) => `<button data-tab="${id}" class="${S.tab === id ? 'active' : ''}">${ic}<span>${l}</span>${id === 'chat' ? '<i class="nav-badge" id="chat-badge" hidden></i>' : ''}</button>`).join('')}</div></nav>
      <main class="page narrow"><div id="view"></div>${footer()}</main>`;
    $('#back').onclick = () => go('home');
    $('#notme').onclick = () => { store.del('me'); S.me = null; go('pick', { bus: me.bus }); };
    $$('.bottom-nav [data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
    startPortalWatch();
    const view = $('#view');
    if (S.tab === 'attend') studentAttend(view);
    else if (S.tab === 'history') studentHistory(view);
    else if (S.tab === 'chat') studentChat(view);
    else infoView(view, me.bus);
  }

  function studentAttend(view) {
    const g = greeting();
    let sig = null;
    view.innerHTML = `
      <div class="card greet-card">
        <div class="greet-sm">${g.icon} ${g.text},</div>
        <div class="greet-name" id="st-name">${esc(S.me.name)}</div>
        <div class="enroll-chip">${esc(S.me.enroll)}</div>
        <div class="details" id="st-details"><div class="muted small">Loading details…</div></div>
      </div>
      <div id="att-main" class="mt"></div>
      <div id="att-today" class="mt"></div>`;
    const drawDetails = (st) => {
      $('#st-name').textContent = st.name;
      $('#st-details').innerHTML = [
        ['Department', st.department], ['Course', st.course + (st.specialization ? ` (${st.specialization})` : '')],
        ['Year', st.year ? ordinal(st.year) + ' Year' : '—'], ['Semester', st.semester ? ordinal(st.semester) + ' Semester' : '—'],
        ['Bus stop', st.stop], ['Bus', st.bus],
      ].map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
    };
    const drawMain = (d) => {
      const s = d.session;
      const box = $('#att-main');
      const cur = d.current;
      const marked = s ? s.alreadyMarked : !!(cur && cur.marked);
      const ref = s || cur;
      box.innerHTML = `
        <div class="card status-card ${marked ? 'is-present' : 'is-faded'}">
          <div class="present-badge">${I.check}</div>
          <h2>${marked ? 'Present' : 'Not marked yet'}</h2>
          <p class="muted" style="margin:0">${marked
            ? `${esc(ref.trip)} trip · ${esc(niceDate(ref.date))}${cur && cur.marked ? ` · ${esc(cur.time)}${cur.method === 'ADMIN' ? ' (marked by admin)' : ''}` : ''}`
            : s ? `${esc(s.trip)} trip is open — enter the OTP below` : 'This turns green after you enter the OTP'}</p>
        </div>
        <div class="card mt otp-card ${s && !marked ? '' : 'disabled'}" ${s && !marked ? `data-expires="${s.expiresAt}" data-start="${s.createdAt}" data-onexpire="1"` : ''}>
          <div class="row-between"><h3 style="margin:0">Enter OTP</h3>
            ${s && !marked ? '<span class="badge green"><span class="dot pulse"></span> Open · <span class="timer">--:--</span></span>' : marked ? '<span class="badge green">Done</span>' : '<span class="badge gray">Portal closed</span>'}</div>
          ${s && !marked ? '<div class="timer-bar"><i style="width:100%"></i></div>' : ''}
          <form id="otp-form">
            <input class="otp-one" id="otp-one" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="6-digit OTP" ${s && !marked ? '' : 'disabled'}>
            <button class="btn orange block" id="otp-btn" ${s && !marked ? '' : 'disabled'}>${I.check} Mark my attendance</button>
          </form>
          <p class="small muted center" style="margin:10px 0 0">${s && !marked
            ? `OTP shared by ${esc(s.createdBy)}.${s.attemptsLeft < 5 ? ` <b>${s.attemptsLeft} attempts left.</b>` : ''}`
            : marked ? 'Your attendance is saved.' : 'The OTP box unlocks when the bus incharge makes the portal live.'}</p>
        </div>`;
      if (!s || marked) return;
      const inp = $('#otp-one', box);
      inp.addEventListener('input', () => (inp.value = inp.value.replace(/\D/g, '').slice(0, 6)));
      $('#otp-form', box).onsubmit = async (e) => {
        e.preventDefault();
        if (inp.value.length !== 6) return toast('Enter the 6-digit OTP', 'err');
        try {
          const r = await busy($('#otp-btn'), () => post('/api/public/mark', { enroll: S.me.enroll, bus: S.me.bus, otp: inp.value, deviceId }));
          toast(`Marked present at ${r.record.time}`, 'ok');
          if (navigator.vibrate) navigator.vibrate(80);
          sig = null; load();
        } catch (err) {
          if (handleStudentErr(err)) return;
          toast(err.message, 'err');
          inp.value = ''; inp.focus();
          if (/attempt|closed|already/i.test(err.message)) { sig = null; load(); }
        }
      };
    };
    const load = async () => {
      let d;
      try { d = await get('/api/public/student?' + qs({ enroll: S.me.enroll, bus: S.me.bus })); } catch (e) { handleStudentErr(e); return; }
      if (!$('#st-details')) return;
      syncClock(d.serverNow);
      S.student = d.student;
      drawDetails(d.student);
      const badge = $('#chat-badge');
      if (badge) { badge.hidden = !d.unreadChats; badge.textContent = d.unreadChats; }
      const s = d.session;
      const nsig = JSON.stringify([s && s.id, s && s.alreadyMarked, s && s.expiresAt, d.current]);
      if (nsig !== sig) { sig = nsig; drawMain(d); }
      $('#att-today').innerHTML = `<div class="card"><h3>Today · ${esc(niceDate(d.today))}</h3>${['Morning', 'Evening'].map((t) => {
        const r = d.todayRecords.find((x) => x.trip === t);
        return `<div class="list-item"><div class="avatar ${r ? 'ok' : 'gray'}">${r ? I.check.replace('<svg', '<svg style="width:18px"') : t[0]}</div><div class="li-main"><div class="t">${t} trip</div><div class="s">${r ? 'Marked at ' + esc(r.time) + (r.method === 'ADMIN' ? ' · by admin' : ' · by you') : 'Not marked'}</div></div>${r ? '<span class="badge green">Present</span>' : '<span class="badge gray">—</span>'}</div>`;
      }).join('')}</div>`;
    };
    onExpired(() => { sig = null; load(); });
    setPoll(load, 4000);
  }

  function studentHistory(view) {
    view.innerHTML = `<div class="card"><h2>My attendance</h2><p class="sub">Choose a period to see your attendance percentage.</p>${chips('hr', ['7d', '1m', '3m', '6m'], S.histRange)}<div id="h-out" class="mt"></div></div>`;
    const load = async () => {
      const out = $('#h-out');
      out.innerHTML = '<p class="muted">Loading…</p>';
      try {
        const d = await get('/api/public/history?' + qs({ enroll: S.me.enroll, bus: S.me.bus, range: S.histRange }));
        const pct = d.held ? Math.round((d.present / d.held) * 100) : 0;
        const col = pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
        out.innerHTML = `
          <div class="ring-row">
            <div class="ring" style="--p:${pct};--c:${col}"><div><b>${d.held ? pct + '%' : '—'}</b><span>attendance</span></div></div>
            <div class="ring-stats">
              <div><span class="dot" style="color:var(--green)"></span> Present <b>${d.present}</b></div>
              <div><span class="dot" style="color:var(--red)"></span> Absent <b>${Math.max(0, d.held - d.present)}</b></div>
              <div><span class="dot" style="color:var(--blue-2)"></span> Trips held <b>${d.held}</b></div>
              <div class="small muted">${esc(shortDate(d.from))} – ${esc(shortDate(d.to))}</div>
            </div>
          </div>
          ${pct < 75 && d.held ? '<div class="alert warn mt">Your bus attendance is below 75% for this period.</div>' : ''}
          <div class="list mt">${d.rows.length ? d.rows.map((r) => `<div class="list-item"><div class="avatar ${r.present ? 'ok' : 'bad'}">${r.present ? I.check.replace('<svg', '<svg style="width:18px"') : '✕'}</div><div class="li-main"><div class="t">${esc(niceDate(r.date))}</div><div class="s">${esc(r.trip)} trip${r.present ? ` · ${esc(r.time)} · ${r.method === 'SELF' ? 'by you' : 'by admin'}` : ''}</div></div><span class="badge ${r.present ? 'green' : 'red'}">${r.present ? 'Present' : 'Absent'}</span></div>`).join('') : `<div class="empty">${I.clock}<div>No trips in this period yet.</div></div>`}</div>`;
      } catch (e) { if (!handleStudentErr(e)) out.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
    };
    bindChips('hr', (v) => { S.histRange = v; load(); });
    load();
  }

  // ----- chat (student) -----
  let rec = null; // { mr, stream, chunks, start, timer, mime, cancelled }
  function stopRecording(cancel) {
    if (!rec) return;
    const r = rec;
    r.cancelled = !!cancel;
    clearInterval(r.timer);
    try { r.mr.state !== 'inactive' && r.mr.stop(); } catch {}
    r.stream.getTracks().forEach((t) => t.stop());
    if (cancel) rec = null;
  }
  function bubble(m, mine) {
    return `<div class="bubble ${mine ? 'me' : 'them'}">${!mine && m.by ? `<div class="by">${esc(m.by)}</div>` : ''}${m.type === 'voice' ? `<audio controls preload="none" src="${m.voice}"></audio>${m.duration ? `<div class="small">🎤 ${m.duration}s</div>` : ''}` : `<div class="txt">${esc(m.text)}</div>`}<div class="at">${esc(when(m.at))}</div></div>`;
  }
  function studentChat(view) {
    view.innerHTML = `
      <div class="card chat-card">
        <div class="chat-head"><div class="avatar">${I.bus.replace('<svg', '<svg style="width:20px"')}</div><div class="li-main"><div class="t">Bus ${esc(S.me.bus)} admins</div><div class="s">Bus Incharge &amp; Transport Incharge</div></div></div>
        <div class="chat-body" id="chat-body"><p class="muted center">Loading…</p></div>
        <div id="rec-bar" class="rec-bar" hidden><span class="rec-dot"></span> Recording <b id="rec-t">0:00</b><span class="grow"></span><button type="button" class="btn sm outline" id="rec-cancel">${I.x} Cancel</button><button type="button" class="btn sm green" id="rec-send">${I.send} Send</button></div>
        <form class="chat-input" id="chat-form">
          <input class="input" id="chat-text" maxlength="1000" placeholder="Type a message…" autocomplete="off">
          <button type="button" class="icon-round mic" id="mic" title="Record a voice message" aria-label="Record a voice message">${I.mic}</button>
          <button class="icon-round" id="send" aria-label="Send">${I.send}</button>
        </form>
      </div>
      <p class="small muted center">Messages go directly to the administrative admins of your bus.</p>`;
    let count = -1;
    const load = async () => {
      try {
        const d = await get('/api/public/chat?' + qs({ enroll: S.me.enroll, bus: S.me.bus }));
        const body = $('#chat-body');
        if (!body || d.messages.length === count) return;
        count = d.messages.length;
        body.innerHTML = d.messages.length ? d.messages.map((m) => bubble(m, m.from === 'student')).join('') : `<div class="empty">${I.msg}<div>No messages yet. Report a delay, ask a question or send a voice note.</div></div>`;
        body.scrollTop = body.scrollHeight;
      } catch (e) { handleStudentErr(e); }
    };
    $('#chat-form').onsubmit = async (e) => {
      e.preventDefault();
      const t = $('#chat-text');
      if (!t.value.trim()) return;
      try { await busy($('#send'), () => post('/api/public/chat', { enroll: S.me.enroll, bus: S.me.bus, text: t.value })); t.value = ''; count = -1; load(); } catch (err) { if (!handleStudentErr(err)) toast(err.message, 'err'); }
    };
    const showRec = (on) => { $('#rec-bar').hidden = !on; $('#chat-form').hidden = on; };
    $('#rec-cancel').onclick = () => { stopRecording(true); showRec(false); };
    $('#rec-send').onclick = () => stopRecording(false);
    $('#mic').onclick = async () => {
      if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Voice messages need a secure (https) connection or a newer browser.', 'err');
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Microphone permission was denied.', 'err'); }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const r = (rec = { mr, stream, chunks: [], start: Date.now(), mime: mr.mimeType || mime || 'audio/webm' });
      mr.ondataavailable = (ev) => ev.data.size && r.chunks.push(ev.data);
      mr.onstop = async () => {
        if (rec === r) rec = null;
        if ($('#rec-bar')) showRec(false);
        if (r.cancelled) return;
        const duration = Math.round((Date.now() - r.start) / 1000);
        if (duration < 1) return toast('Recording too short.', 'err');
        const blob = new Blob(r.chunks, { type: r.mime });
        const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
        try { await post('/api/public/chat', { enroll: S.me.enroll, bus: S.me.bus, audio: b64, mime: r.mime, duration }); toast('Voice message sent', 'ok'); count = -1; load(); } catch (err) { toast(err.message, 'err'); }
      };
      mr.start(250);
      showRec(true);
      r.timer = setInterval(() => {
        const s = Math.floor((Date.now() - r.start) / 1000);
        const el = $('#rec-t'); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        if (s >= 120) stopRecording(false);
      }, 300);
    };
    setPoll(load, 5000);
  }

  // ---------- shared: notices, stops, contacts ----------
  function contactsGrid(contacts, bus) {
    const icons = { transport: ['o', I.user], busincharge: ['b', I.bus], coordinator: ['p', I.users] };
    return `<div class="card"><h2>${esc(bus)} In-Charges &amp; Coordinators</h2><p class="sub">Common contact card for ${esc(bus)} bus attendance</p>
      <div class="contact-grid">${contacts.map((c) => {
        const [cls, ic] = icons[c.role] || icons.busincharge;
        return `<div class="contact-cell"><div class="ct-ic ${cls}">${ic}</div><div class="li-main"><div class="ct-role">${esc(c.title)}</div><div class="ct-name">${esc(c.name)}</div>${c.phone ? `<a class="ct-phone" href="${telHref(c.phone)}">${I.phone} ${esc(c.phone)}</a>` : ''}</div></div>`;
      }).join('')}</div></div>`;
  }
  async function infoView(view, bus) {
    view.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
    let d;
    try { d = await get('/api/public/info?bus=' + encodeURIComponent(bus)); } catch (e) { view.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
    const myStop = S.view === 'student' && S.student ? S.student.stop : null;
    const canRemove = isAdmin() && S.view === 'staff';
    view.innerHTML = `
      <div class="section-title"><h2>Notices</h2><span class="badge">${d.notices.length}</span></div>
      ${d.notices.length ? d.notices.map((n) => `<div class="notice ${n.pinned ? 'pinned' : ''}"><div class="t">${n.pinned ? '📌 ' : ''}${esc(n.title)}</div><div class="b">${esc(n.body)}</div><div class="m"><span>${esc(n.by)} · ${esc(when(n.at))}${n.bus === '*' ? ' · All buses' : ''}</span>${canRemove ? `<button class="btn sm outline" data-rm="${n.id}">Remove</button>` : ''}</div></div>`).join('') : `<div class="card empty">${I.bell}<div>No notices right now.</div></div>`}
      <div class="section-title mt"><h2>Bus ${esc(bus)} stops</h2><span class="badge orange">${d.stops.length} stops</span></div>
      <div class="card">
        ${d.bus?.route ? `<p class="sub" style="margin-bottom:6px">${esc(d.bus.route)}</p>` : ''}
        ${d.bus?.vehicleNo || d.bus?.driver ? `<p class="small muted" style="margin-top:0">${d.bus.vehicleNo ? 'Vehicle: <b>' + esc(d.bus.vehicleNo) + '</b>' : ''}${d.bus.driver ? ' · Driver: <b>' + esc(d.bus.driver) + '</b>' + (d.bus.driverPhone ? ` (<a href="${telHref(d.bus.driverPhone)}">${esc(d.bus.driverPhone)}</a>)` : '') : ''}</p>` : ''}
        ${d.stops.length ? `<div class="route">${d.stops.map((s, i) => {
          const campus = /university|campus/i.test(s.name) && i === d.stops.length - 1;
          const mine = myStop && s.name === myStop;
          return `<div class="stop ${mine ? 'mine' : ''} ${campus ? 'campus' : ''}"><div class="pin"><b>${campus ? 'UU' : i + 1}</b></div><div class="info"><div class="t">${esc(s.name)} ${mine ? '<span class="badge orange">Your stop</span>' : ''}</div><div class="small muted">${s.time ? 'Approx. ' + esc(s.time) : ''}${s.time && s.students ? ' · ' : ''}${s.students ? `${s.students} student${s.students > 1 ? 's' : ''}` : ''}</div></div></div>`;
        }).join('')}</div>` : `<div class="empty">${I.pin}<div>Stops not added yet.</div></div>`}
      </div>
      <div class="mt">${d.contacts.length ? contactsGrid(d.contacts, bus) : ''}</div>`;
    $$('[data-rm]', view).forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('Remove notice?', 'Students will no longer see this notice.', 'Remove', true))) return;
      try { await post('/api/admin/notice/remove', { id: b.dataset.rm }); toast('Notice removed', 'ok'); infoView(view, bus); } catch (e) { toast(e.message, 'err'); }
    }));
  }

  // ======================================================================
  // ADMIN LOGIN (all staff)
  // ======================================================================
  function renderLogin(app) {
    const mode = S.loginMode;
    const labels = { admin: 'Administrative Admin', coordinator: 'Student Coordinator', super: 'Super Admin' };
    app.innerHTML = `
      <section class="hero">${themeBtn('hero-theme')}<div class="hero-inner">
        <button class="icon-btn" id="back" aria-label="Back">${I.back}</button>
        <img src="/logo.png" alt=""><div><h1>Admin login</h1><p>United University Bus ERP</p></div></div></section>
      <main class="page lift">
        <div class="card login-card">
          <div class="seg seg3" role="tablist">
            ${Object.entries(labels).map(([k, l]) => `<button data-mode="${k}" class="${mode === k ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <div class="alert info">${{
            admin: 'For the Bus Incharge / faculty coordinator and the Transport Incharge. Only these accounts and the Super Admin can generate the attendance OTP.',
            coordinator: 'Student coordinators can see how many students marked attendance and the average attendance.',
            super: 'Full control over all buses, students and admin accounts.',
          }[mode]}</div>
          <form id="login-form" autocomplete="on">
            <label class="field"><span>Login ID</span><input class="input" name="id" required autocomplete="username" placeholder="e.g. UUAD1234" style="text-transform:uppercase"></label>
            <label class="field"><span>Password</span>
              <div class="pw-wrap"><input class="input" name="password" type="password" required autocomplete="current-password"><button type="button" id="pw-toggle">SHOW</button></div></label>
            <div id="login-err"></div>
            <button class="btn block">Sign in as ${labels[mode]}</button>
          </form>
          <p class="center mt" style="margin-bottom:0"><a href="#" id="forgot">Forgot password? Get an OTP by e-mail</a></p>
        </div>
        ${footer()}
      </main>`;
    $('#back').onclick = () => go('home');
    $$('[data-mode]').forEach((b) => (b.onclick = () => { S.loginMode = b.dataset.mode; render(); }));
    $('#pw-toggle').onclick = (e) => { const i = $('[name=password]'); i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'SHOW' : 'HIDE'; };
    $('#forgot').onclick = (e) => { e.preventDefault(); forgotModal($('[name=id]').value.trim()); };
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      $('#login-err').innerHTML = '';
      try {
        const r = await busy(f.querySelector('.btn'), () => post('/api/login', { role: mode, id: f.id.value.trim(), password: f.password.value }));
        S.token = r.token; S.user = r.user; store.set('token', r.token);
        if (r.user.bus !== '*') S.adminBus = r.user.bus;
        S.tab = null;
        toast('Welcome, ' + r.user.name.split(' (')[0], 'ok');
        go('staff');
      } catch (err) { $('#login-err').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    };
  }

  function forgotModal(prefill) {
    modal(`<h2>Reset password</h2>
      <div id="fp-step1">
        <p class="muted">Enter your login ID. We will e-mail a one-time password (OTP) to the address saved on your account.</p>
        <label class="field"><span>Login ID</span><input class="input" id="fp-id" value="${esc(prefill)}" style="text-transform:uppercase"></label>
        <div class="btn-row"><button class="btn outline" data-close style="flex:1">Cancel</button><button class="btn" id="fp-send" style="flex:1">${I.mail} Send OTP</button></div>
      </div>
      <form id="fp-step2" hidden>
        <div class="alert ok" id="fp-sent"></div>
        <label class="field"><span>OTP from e-mail</span><input class="otp-one" id="fp-otp" inputmode="numeric" maxlength="6" placeholder="••••••" required></label>
        <label class="field"><span>New password (min 8 characters)</span><input class="input" type="password" id="fp-np" minlength="8" required autocomplete="new-password"></label>
        <label class="field"><span>Confirm new password</span><input class="input" type="password" id="fp-np2" minlength="8" required autocomplete="new-password"></label>
        <button class="btn block" id="fp-save">Reset password</button>
        <p class="center small mt" style="margin-bottom:0"><a href="#" id="fp-resend">Resend OTP</a></p>
      </form>`, (m, close) => {
      const send = async (btn) => {
        const id = $('#fp-id', m).value.trim();
        if (!id) return toast('Enter your login ID', 'err');
        try {
          const r = await busy(btn, () => post('/api/forgot', { id }));
          $('#fp-step1', m).hidden = true;
          $('#fp-step2', m).hidden = false;
          $('#fp-sent', m).innerHTML = `OTP sent to <b>${esc(r.sentTo)}</b>. It is valid for 10 minutes.${r.dev ? '<br><small>E-mail sending is not set up yet, so the OTP was printed in the server console.</small>' : ''}`;
          $('#fp-otp', m).focus();
        } catch (err) { toast(err.message, 'err'); }
      };
      $('#fp-send', m).onclick = (e) => send(e.currentTarget);
      $('#fp-resend', m).onclick = (e) => { e.preventDefault(); send(e.currentTarget); };
      $('#fp-otp', m).oninput = (e) => (e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6));
      $('#fp-step2', m).onsubmit = async (e) => {
        e.preventDefault();
        if ($('#fp-np', m).value !== $('#fp-np2', m).value) return toast('Passwords do not match', 'err');
        try {
          await busy($('#fp-save', m), () => post('/api/forgot/verify', { id: $('#fp-id', m).value.trim(), otp: $('#fp-otp', m).value, newPassword: $('#fp-np', m).value }));
          close(); toast('Password reset. Sign in with your new password.', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      };
    });
  }

  function staffLogout(silent) {
    if (S.token && !silent) post('/api/logout').catch(() => {});
    S.token = null; S.user = null; S.tab = null;
    store.del('token');
    go('home');
  }

  // ======================================================================
  // STAFF SHELL
  // ======================================================================
  function renderStaff(app) {
    const u = S.user;
    const admin = isAdmin();
    if (u.bus !== '*') S.adminBus = u.bus;
    const tabs = admin
      ? [['live', 'Live', I.live], ['students', 'Students', I.users], ['reports', 'Reports', I.chart], ['chats', 'Chats', I.msg], ['notices', 'Notices', I.bell], ['settings', 'Settings', I.gear]]
      : [['dash', 'Dashboard', I.chart], ['info', 'Stops', I.route], ['account', 'Account', I.user]];
    S.tab = tabs.some((t) => t[0] === S.tab) ? S.tab : tabs[0][0];
    const switcher = u.bus === '*'
      ? `<select class="bus-switch" id="bus-switch" aria-label="Bus">${Array.from({ length: 21 }, (_, i) => `UU-${i + 1}`).map((b) => `<option ${b === S.adminBus ? 'selected' : ''}>${b}</option>`).join('')}</select>`
      : '';
    app.innerHTML = `<header class="topbar">
        <img class="logo" src="/logo.png" alt="UU">
        <div class="grow"><div class="t1">${esc(u.role === 'super' ? 'Super Admin' : u.title)}</div><div class="t2">${u.role === 'super' ? 'Full access' : esc(u.name)} · Bus ${esc(S.adminBus)}</div></div>
        ${switcher}
        ${themeBtn()}
        <button class="icon-btn" id="tb-home" title="Student portal" aria-label="Student portal">${I.bus}</button>
        <button class="icon-btn" id="tb-logout" title="Sign out" aria-label="Sign out">${I.logout}</button>
      </header>
      <nav class="bottom-nav"><div class="inner">${tabs.map(([id, l, ic]) => `<button data-tab="${id}" class="${S.tab === id ? 'active' : ''}">${ic}<span>${l}</span>${id === 'chats' ? '<i class="nav-badge" id="chat-badge" hidden></i>' : ''}</button>`).join('')}</div></nav>
      <main class="page ${admin ? '' : 'narrow'}"><div id="view"></div>${footer()}</main>`;
    $('#tb-logout').onclick = async () => { if (await confirmBox('Sign out?', 'You will need your login ID and password to sign in again.', 'Sign out')) staffLogout(); };
    $('#tb-home').onclick = () => go('home');
    $$('.bottom-nav [data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; S.chatWith = null; render(); window.scrollTo(0, 0); }));
    const sw = $('#bus-switch');
    if (sw) sw.onchange = () => { S.adminBus = sw.value; store.set('adminBus', S.adminBus); S.live.lastSessionId = undefined; S.chatWith = null; render(); };
    const view = $('#view');
    ({ live: adminLive, students: adminStudents, reports: adminReports, chats: adminChats, notices: adminNotices, settings: adminSettings, dash: coordDash, info: (v) => infoView(v, u.bus), account: accountView })[S.tab](view);
  }

  // ---------- coordinator ----------
  function coordDash(view) {
    view.innerHTML = `<div id="cd-live"><div class="card"><p class="muted">Loading…</p></div></div>
      <div class="card mt"><h2>Attendance overview</h2><p class="sub">Total marked and average students present per trip.</p>${chips('cr', ['1d', '7d', '1m', '3m', '6m'], S.coordRange)}<div id="cd-out" class="mt"></div></div>
      <p class="small muted center mt">Coordinators see numbers only. OTPs and student names are visible to administrative admins.</p>`;
    const load = async () => {
      let d;
      try { d = await get('/api/coord/summary?range=' + S.coordRange); } catch (e) { $('#cd-live').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
      if (!$('#cd-live')) return;
      const s = d.session;
      if (s.open) syncClock(s.serverNow);
      $('#cd-live').innerHTML = `<div class="card" ${s.open ? `data-expires="${s.expiresAt}" data-start="${s.createdAt}"` : ''}>
        <div class="row-between mb"><h2 style="margin:0">Live attendance · ${esc(d.bus)}</h2>${s.open ? '<span class="badge green"><span class="dot pulse"></span> Portal open</span>' : '<span class="badge gray">Portal closed</span>'}</div>
        ${s.open
          ? `<div class="progress-ring"><div class="big-num">${s.marked}<small> / ${d.total}</small></div><div class="li-main"><div class="t">${esc(s.trip)} trip</div><div class="s">students marked · closes in <span class="timer">--:--</span></div></div></div><div class="pbar mt"><i style="width:${d.total ? (s.marked / d.total) * 100 : 0}%"></i></div>`
          : `<div class="grid stats" style="grid-template-columns:1fr 1fr"><div class="stat blue card flat"><div class="k">Today · Morning</div><div class="v">${d.today.Morning}<small class="muted" style="font-size:14px"> / ${d.total}</small></div></div><div class="stat orange card flat"><div class="k">Today · Evening</div><div class="v">${d.today.Evening}<small class="muted" style="font-size:14px"> / ${d.total}</small></div></div></div>`}
      </div>`;
      const max = d.daily ? Math.max(1, ...d.daily.map((x) => Math.max(x.Morning, x.Evening))) : 1;
      $('#cd-out').innerHTML = `
        <div class="grid stats">
          <div class="card stat green flat"><div class="k">Total marked</div><div class="v">${d.totalMarked}</div></div>
          <div class="card stat blue flat"><div class="k">Avg present / trip</div><div class="v">${d.avgPresent}<small class="muted" style="font-size:14px"> / ${d.total}</small></div></div>
          <div class="card stat orange flat"><div class="k">Avg attendance</div><div class="v">${d.avgPercent}%</div></div>
          <div class="card stat flat"><div class="k">Trips held</div><div class="v">${d.tripsHeld}</div></div>
        </div>
        ${d.daily && d.daily.length > 1 ? `<div class="bars mt">${d.daily.map((x) => `<div class="col" title="${x.date}: Morning ${x.Morning}, Evening ${x.Evening}"><div class="stack"><i class="m" style="height:${(x.Morning / max) * 100}%"></i><i class="e" style="height:${(x.Evening / max) * 100}%"></i></div><div class="lbl">${d.daily.length > 10 ? x.date.slice(8) : shortDate(x.date)}</div></div>`).join('')}</div><div class="legend"><span style="--c:var(--blue-2)">Morning</span><span style="--c:var(--orange)">Evening</span></div>` : ''}
        <p class="small muted" style="margin:10px 0 0">${esc(niceDate(d.from))} – ${esc(niceDate(d.to))} · ${d.total} registered students</p>`;
    };
    bindChips('cr', (v) => { S.coordRange = v; load(); });
    setPoll(load, 6000);
  }

  function accountView(view) {
    const u = S.user;
    view.innerHTML = `
      <div class="card center acct-head"><div class="avatar" style="width:72px;height:72px;font-size:24px;margin:0 auto 10px;border-radius:20px">${esc(initials(u.name))}</div><h2>${esc(u.name)}</h2><span class="badge">${esc(u.role === 'super' ? 'Super Admin' : u.title)}</span></div>
      <div class="card mt acct-body">
        <h3>My account</h3>
        <div class="list-item"><div class="li-main"><div class="s">Login ID</div><div class="t">${esc(u.username)}</div></div></div>
        <div class="list-item"><div class="li-main"><div class="s">Bus</div><div class="t">${u.bus === '*' ? 'All buses' : esc(u.bus)}</div></div></div>
        <form id="em-form" class="mt"><label class="field"><span>E-mail for password-reset OTP</span><div class="row" style="flex-wrap:nowrap"><input class="input" type="email" name="email" value="${esc(u.email)}" placeholder="you@example.com"><button class="btn" style="flex:0 0 auto">Save</button></div></label></form>
        ${!u.email ? '<div class="alert warn">Add your e-mail so you can reset your password with an OTP if you forget it.</div>' : ''}
        <button class="btn ghost block" id="pw-btn">${I.key} Change password</button>
      </div>`;
    $('#em-form', view).onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await busy(e.target.querySelector('.btn'), () => post('/api/me/email', { email: e.target.email.value })); S.user = r.user; toast('E-mail saved', 'ok'); render(); } catch (err) { toast(err.message, 'err'); }
    };
    $('#pw-btn', view).onclick = changePasswordModal;
  }
  function changePasswordModal() {
    modal(`<h2>Change password</h2>
      <form id="pw-form">
        <label class="field"><span>Current password</span><input class="input" type="password" name="old" required autocomplete="current-password"></label>
        <label class="field"><span>New password (min 8 characters)</span><input class="input" type="password" name="np" required minlength="8" autocomplete="new-password"></label>
        <label class="field"><span>Confirm new password</span><input class="input" type="password" name="np2" required minlength="8" autocomplete="new-password"></label>
        <div class="btn-row"><button type="button" class="btn outline" data-close style="flex:1">Cancel</button><button class="btn" id="pw-save" style="flex:1">Save password</button></div>
      </form>`, (m, close) => {
      $('#pw-form', m).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        if (f.np.value !== f.np2.value) return toast('New passwords do not match', 'err');
        try { await busy($('#pw-save', m), () => post('/api/me/password', { oldPassword: f.old.value, newPassword: f.np.value })); close(); toast('Password updated', 'ok'); } catch (err) { toast(err.message, 'err'); }
      };
    });
  }

  // ---------- admin: live ----------
  function adminLive(view) {
    const bus = S.adminBus;
    let sig = null, data = null;
    view.innerHTML = `<div class="grid two"><div id="lv-otp"><div class="card"><p class="muted">Loading…</p></div></div><div id="lv-progress"></div></div>
      <div id="lv-window"></div>
      <div class="card mt"><div class="row-between mb"><h2 id="lv-title" style="margin:0">Students</h2><span class="small muted" id="lv-upd"></span></div>
      <div class="toolbar"><input class="input" id="lv-q" placeholder="Search name, enrollment or stop" value="${esc(S.live.q)}">
      <div class="chips" id="lv-filter">${['all', 'marked', 'pending'].map((f) => `<button class="chip ${S.live.filter === f ? 'active' : ''}" data-f="${f}">${{ all: 'All', marked: 'Present', pending: 'Not marked' }[f]}</button>`).join('')}</div></div>
      <div class="list" id="lv-list"></div></div>`;
    $('#lv-q').oninput = (e) => { S.live.q = e.target.value; drawList(); };
    $$('#lv-filter [data-f]').forEach((b) => (b.onclick = () => { S.live.filter = b.dataset.f; $$('#lv-filter .chip').forEach((c) => c.classList.toggle('active', c === b)); drawList(); }));

    const drawOtp = () => {
      const s = data.session;
      const box = $('#lv-otp');
      if (!s) {
        const mins = data.settings.otpMinutes;
        const inHours = mins >= 60 && mins % 60 === 0;
        const trip = S.live.trip || data.trip;
        box.innerHTML = `<div class="card" style="height:100%">
          <h2>Make the portal live</h2><p class="sub">Generate an OTP and announce it in the bus. The portal closes automatically when the time runs out.</p>
          <label class="field"><span>Trip</span><div class="seg" style="margin:0" id="trip-seg">${['Morning', 'Evening'].map((t) => `<button type="button" data-t="${t}" class="${trip === t ? 'active' : ''}">${t}</button>`).join('')}</div></label>
          <label class="field"><span>OTP valid for</span>
            <div class="row" style="align-items:center;flex-wrap:nowrap"><input class="input" id="otp-val" type="number" min="1" max="240" value="${inHours ? mins / 60 : mins}" style="max-width:100px;flex:0 0 100px">
            <select class="input" id="otp-unit" style="max-width:130px;flex:0 0 130px"><option value="1" ${inHours ? '' : 'selected'}>minutes</option><option value="60" ${inHours ? 'selected' : ''}>hours</option></select></div></label>
          <div class="chips mb">${[[2, '2 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours']].map(([m, l]) => `<button type="button" class="chip ${m === mins ? 'active' : ''}" data-m="${m}">${l}</button>`).join('')}</div>
          <button class="btn orange block" id="otp-gen">${I.key} Generate OTP &amp; go live</button>
        </div>`;
        $$('#trip-seg [data-t]').forEach((b) => (b.onclick = () => { S.live.trip = b.dataset.t; sig = null; refresh(); }));
        $$('[data-m]', box).forEach((c) => (c.onclick = () => {
          const m = Number(c.dataset.m);
          $('#otp-val').value = m >= 60 ? m / 60 : m; $('#otp-unit').value = m >= 60 ? '60' : '1';
          $$('[data-m]', box).forEach((x) => x.classList.toggle('active', x === c));
        }));
        $('#otp-gen').onclick = async (e) => {
          const minutes = Number($('#otp-val').value) * Number($('#otp-unit').value);
          if (!(minutes >= 1 && minutes <= 240)) return toast('Validity must be between 1 minute and 4 hours', 'err');
          try {
            await busy(e.currentTarget, () => post('/api/admin/session/start', { bus, trip: S.live.trip || data.trip, minutes }));
            toast('Portal is live — announce the OTP', 'ok');
            sig = null; refresh();
          } catch (err) {
            if (err.code === 'BUSY') { popup5('OTP is being generated', `The OTP for ${esc(bus)} is already being generated by <b>${esc(err.by)}</b>.`); sig = null; refresh(); }
            else toast(err.message, 'err');
          }
        };
        return;
      }
      box.innerHTML = `<div class="otp-display" data-expires="${s.expiresAt}" data-start="${s.createdAt}" data-onexpire="1">
        <div class="label">${esc(s.trip)} trip · Attendance OTP</div>
        <div class="otp-digits">${esc(s.otp)}</div>
        <div>Portal closes in <span class="timer">--:--</span></div>
        <div class="timer-bar"><i style="width:100%"></i></div>
        <div class="btn-row">
          <button class="btn sm ghost" data-act="extend" data-min="5">+5 min</button>
          <button class="btn sm ghost" data-act="extend" data-min="15">+15 min</button>
          <button class="btn sm ghost" data-act="regenerate">${I.refresh} New OTP</button>
          <button class="btn sm red" data-act="close">${I.lock} Close now</button>
        </div>
        <div class="btn-row share-row">
          <a class="btn sm wa" id="wa-share" target="_blank" rel="noopener noreferrer">${I.whatsapp} Share OTP on WhatsApp</a>
          <button class="btn sm ghost" id="otp-copy">Copy message</button>
        </div>
        <div class="small" style="opacity:.85;margin-top:10px;position:relative;z-index:1">Generated by ${esc(s.createdByUser === data.me ? 'you' : s.createdBy)} at ${esc(clock(s.createdAt))}</div>
      </div>`;
      const shareText = otpShareMessage(s, bus);
      $('#wa-share', box).href = 'https://wa.me/?text=' + encodeURIComponent(shareText);
      $('#otp-copy', box).onclick = () => navigator.clipboard?.writeText(shareText).then(() => toast('Message copied — paste it in WhatsApp', 'ok')).catch(() => toast('Copy failed', 'err'));
      $$('[data-act]', box).forEach((b) => (b.onclick = async () => {
        const act = b.dataset.act;
        if (act === 'close' && !(await confirmBox('Close the attendance portal?', 'Students will no longer be able to mark attendance. You can still mark students manually for 1 hour.', 'Close portal', true))) return;
        try {
          await busy(b, () => post('/api/admin/session/' + act, { bus, minutes: Number(b.dataset.min || 5) }));
          toast({ extend: `Extended by ${b.dataset.min} minutes`, regenerate: 'New OTP generated', close: 'Portal closed' }[act], 'ok');
          sig = null; refresh();
        } catch (err) { toast(err.message, 'err'); }
      }));
    };

    const drawProgress = () => {
      const pct = data.total ? Math.round((data.marked / data.total) * 100) : 0;
      const self = data.students.filter((s) => s.method === 'SELF').length;
      $('#lv-progress').innerHTML = `<div class="card" style="height:100%">
        <div class="row-between mb"><h2 style="margin:0">${esc(data.trip)} · ${esc(niceDate(data.date))}</h2>${data.session ? '<span class="badge green"><span class="dot pulse"></span> Live</span>' : '<span class="badge gray">Closed</span>'}</div>
        <div class="progress-ring"><div class="big-num">${data.marked}<small> / ${data.total}</small></div><div class="li-main"><div class="t">${pct}% present</div><div class="s">${self} marked by students · ${data.marked - self} by admin</div></div></div>
        <div class="pbar mt"><i style="width:${pct}%"></i></div>
        <div class="grid stats mt" style="grid-template-columns:1fr 1fr">
          <div class="stat green card flat"><div class="k">Present</div><div class="v">${data.marked}</div></div>
          <div class="stat red card flat"><div class="k">Not marked</div><div class="v">${data.total - data.marked}</div></div>
        </div>
      </div>`;
      const w = data.working;
      $('#lv-window').innerHTML = !data.session && w && data.canManual
        ? `<div class="alert warn mt">The ${esc(w.trip)} portal closed at ${esc(clock(w.closedAt || w.expiresAt))}. You can still mark students manually until <b>${esc(clock(w.manualUntil))}</b>; after that, unmarked students remain absent.</div>`
        : data.session ? '<div class="alert info mt">You can mark students manually while the portal is live and for 1 hour after the OTP expires.</div>' : '';
    };

    const drawList = () => {
      if (!data) return;
      const q = S.live.q.trim().toLowerCase();
      let list = data.students;
      if (S.live.filter === 'marked') list = list.filter((s) => s.marked);
      if (S.live.filter === 'pending') list = list.filter((s) => !s.marked);
      if (q) list = list.filter((s) => (s.name + ' ' + s.enroll + ' ' + s.stop).toLowerCase().includes(q));
      $('#lv-title').textContent = `Students on ${bus} (${list.length})`;
      $('#lv-list').innerHTML = list.length ? list.map((s) => `
        <div class="list-item">
          <div class="avatar ${s.marked ? 'ok' : ''}">${s.marked ? I.check.replace('<svg', '<svg style="width:18px"') : esc(initials(s.name))}</div>
          <div class="li-main"><div class="t">${esc(s.name)}</div><div class="s">${esc(s.enroll)} · ${esc(s.stop)}${s.pct30 !== null ? ` · 30-day ${s.pct30}%` : ''}</div></div>
          <div class="li-side">${s.marked
            ? `<span class="badge ${s.method === 'SELF' ? 'green' : 'orange'}">${s.method === 'SELF' ? 'Self' : 'Admin'} · ${esc(s.time)}</span>${s.method === 'ADMIN' ? `<span class="small muted">${esc(s.markedBy)}</span>` : ''}`
            : data.canManual ? `<button class="btn sm ghost" data-mark="${esc(s.enroll)}">Mark present</button>` : `<span class="badge gray">${data.working ? 'Absent' : '—'}</span>`}</div>
        </div>`).join('') : `<div class="empty">${I.users}<div>${data.total ? 'No students match.' : 'No students on this bus yet.'}</div></div>`;
      $$('[data-mark]').forEach((b) => (b.onclick = () => manualMark(b.dataset.mark)));
    };

    const manualMark = (enroll) => {
      const st = data.students.find((x) => x.enroll === enroll);
      const w = data.working;
      modal(`<h2>Mark present manually</h2>
        <div class="list-item" style="padding-top:0"><div class="avatar">${esc(initials(st.name))}</div><div class="li-main"><div class="t">${esc(st.name)}</div><div class="s">${esc(st.enroll)} · ${esc(w.trip)} trip · ${esc(niceDate(w.date))}</div></div></div>
        <form id="mm-form"><label class="field"><span>Reason (optional)</span><input class="input" name="reason" maxlength="120" placeholder="e.g. Phone battery dead"></label>
        <div class="alert info">The record will show that you marked it. Attendance can't be deleted.</div>
        <div class="btn-row"><button type="button" class="btn outline" data-close style="flex:1">Cancel</button><button class="btn green" id="mm-ok" style="flex:1">${I.check} Mark present</button></div></form>`, (m, close) => {
        $('#mm-form', m).onsubmit = async (e) => {
          e.preventDefault();
          try {
            await busy($('#mm-ok', m), () => post('/api/admin/mark', { bus, enroll, sessionId: w.id, reason: e.target.reason.value }));
            close(); toast(`${st.name} marked present`, 'ok'); refresh();
          } catch (err) { toast(err.message, 'err'); }
        };
      });
    };

    const refresh = async () => {
      try { data = await get(`/api/admin/live?${qs({ bus, trip: S.live.trip })}`); } catch (e) { const b = $('#lv-otp'); if (b) b.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
      if (!$('#lv-otp')) return;
      if (data.session) syncClock(data.session.serverNow);
      // Another admin just made the portal live → 5-second popup
      const sid = data.session ? data.session.id : null;
      if (S.live.lastSessionId !== undefined && sid && sid !== S.live.lastSessionId && data.session.createdByUser !== data.me) {
        popup5('OTP is being generated', `The ${esc(data.session.trip)} OTP for ${esc(bus)} was just generated by <b>${esc(data.session.createdBy)}</b>.`);
      }
      S.live.lastSessionId = sid;
      const badge = $('#chat-badge');
      if (badge) { badge.hidden = !data.unreadChats; badge.textContent = data.unreadChats; }
      const nsig = JSON.stringify([sid, data.session && data.session.otp, data.session && data.session.expiresAt, data.trip, data.settings.otpMinutes]);
      if (nsig !== sig) { sig = nsig; drawOtp(); }
      drawProgress();
      drawList();
      $('#lv-upd').textContent = 'Live · ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    onExpired(() => { sig = null; refresh(); });
    setPoll(refresh, 3000);
  }

  // ---------- admin: students ----------
  async function adminStudents(view) {
    const bus = S.adminBus;
    view.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
    let d;
    try { d = await get(`/api/admin/students?${qs({ bus, range: S.stuRange })}`); } catch (e) { view.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
    view.innerHTML = `
      <div class="section-title"><h2>Students · ${esc(bus)} <span class="badge">${d.students.length}</span></h2>${d.canEdit ? `<button class="btn sm" id="st-add">${I.plus} Add student</button>` : ''}</div>
      <div class="card">
        <div class="toolbar"><input class="input" id="st-q" placeholder="Search name or enrollment">
          <select class="input" id="st-stop"><option value="">All stops</option>${d.stops.map((s) => `<option>${esc(s)}</option>`).join('')}</select></div>
        <div class="row-between mb"><span class="small muted">Attendance % over</span>${chips('sr', ['7d', '1m', '3m', '6m'], S.stuRange)}</div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Enrollment</th><th>Course</th><th>Yr / Sem</th><th>Stop</th><th>Today</th><th>${RANGE_LABELS[d.range]} %</th>${d.canEdit ? '<th></th>' : ''}</tr></thead><tbody id="st-body"></tbody></table></div>
        <p class="small muted" style="margin:10px 0 0">${d.held} trips held in this period.${d.canEdit ? ' Changes appear on the student and admin portals within seconds.' : ' Only the Super Admin can add or remove students.'}</p>
      </div>`;
    const draw = () => {
      const q = $('#st-q').value.toLowerCase(), stop = $('#st-stop').value;
      const list = d.students.filter((s) => (!q || (s.name + s.enroll).toLowerCase().includes(q)) && (!stop || s.stop === stop));
      $('#st-body').innerHTML = list.length ? list.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.enroll)}</td><td>${esc(s.course)}</td><td>${s.year ? s.year + ' / ' + s.semester : '—'}</td><td>${esc(s.stop)}</td>
        <td><span class="badge ${s.todayMorning ? 'green' : 'gray'}">M</span> <span class="badge ${s.todayEvening ? 'green' : 'gray'}">E</span></td>
        <td>${s.pct === null ? '—' : `<span class="badge ${s.pct >= 75 ? 'green' : s.pct >= 50 ? 'orange' : 'red'}">${s.pct}%</span>`}</td>
        ${d.canEdit ? `<td><button class="btn sm outline" data-edit="${esc(s.enroll)}">Edit</button> <button class="btn sm red-o" data-rm="${esc(s.enroll)}">Remove</button></td>` : ''}</tr>`).join('') : '<tr><td colspan="9" class="center muted">No students</td></tr>';
      $$('[data-edit]').forEach((b) => (b.onclick = () => studentModal(d, d.students.find((x) => x.enroll === b.dataset.edit))));
      $$('[data-rm]').forEach((b) => (b.onclick = async () => {
        const s = d.students.find((x) => x.enroll === b.dataset.rm);
        if (!(await confirmBox('Remove student?', `<b>${esc(s.name)}</b> (${esc(s.enroll)}) will be removed from bus ${esc(bus)}. Their past attendance stays in reports.`, 'Remove', true))) return;
        try { await post('/api/super/students/remove', { enroll: s.enroll }); toast('Student removed', 'ok'); render(); } catch (e) { toast(e.message, 'err'); }
      }));
    };
    $('#st-q').oninput = draw;
    $('#st-stop').onchange = draw;
    bindChips('sr', (v) => { S.stuRange = v; render(); });
    const add = $('#st-add');
    if (add) add.onclick = () => studentModal(d, null);
    draw();
  }

  function studentModal(d, st) {
    const isNew = !st;
    const bus = S.adminBus;
    st = st || { enroll: '', name: '', programme: '', stop: d.stops[0] || '', phone: '', bus };
    modal(`<h2>${isNew ? 'Add student to a bus' : 'Edit / move student'}</h2>
      <form id="sm-form">
        <div class="row"><label class="field"><span>Enrollment number</span><input class="input" name="enroll" value="${esc(st.enroll)}" ${isNew ? '' : 'readonly'} required style="text-transform:uppercase"></label>
        <label class="field"><span>Bus</span><select class="input" name="bus">${Array.from({ length: 21 }, (_, i) => `UU-${i + 1}`).map((b) => `<option ${b === (st.bus || bus) ? 'selected' : ''}>${b}</option>`).join('')}</select></label></div>
        <label class="field"><span>Full name</span><input class="input" name="name" value="${esc(st.name)}" required></label>
        <label class="field"><span>Programme (e.g. COMP-BCA-2025-2-COMP)</span><input class="input" name="programme" value="${esc(st.programme)}"></label>
        <div class="row"><label class="field"><span>Department</span><input class="input" name="department" placeholder="auto"></label>
        <label class="field"><span>Year</span><input class="input" type="number" min="1" max="6" name="year" placeholder="auto"></label>
        <label class="field"><span>Semester</span><input class="input" type="number" min="1" max="12" name="semester" placeholder="auto"></label></div>
        <div class="row"><label class="field"><span>Bus stop</span><input class="input" name="stop" list="stops-dl" value="${esc(st.stop)}" required><datalist id="stops-dl">${d.stops.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label class="field"><span>Phone</span><input class="input" name="phone" value="${esc(st.phone)}" inputmode="tel"></label></div>
        <p class="small muted" style="margin-top:0">Leave Department/Year/Semester blank to work them out from the programme and enrollment number.</p>
        <div class="btn-row"><button type="button" class="btn outline" data-close style="flex:1">Cancel</button><button class="btn" style="flex:1" id="sm-save">Save</button></div>
      </form>`, (m, close) => {
      $('#sm-form', m).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          await busy($('#sm-save', m), () => post('/api/super/students/save', { isNew, enroll: f.enroll.value, bus: f.bus.value, name: f.name.value, programme: f.programme.value, department: f.department.value, year: f.year.value, semester: f.semester.value, stop: f.stop.value, phone: f.phone.value }));
          close(); toast('Student saved — portals update automatically', 'ok'); render();
        } catch (err) { toast(err.message, 'err'); }
      };
    });
  }

  // ---------- admin: reports ----------
  function adminReports(view) {
    const bus = S.adminBus;
    const today = todayIST();
    const minDate = addDays(today, -183);
    const R = (S.report = S.report || { from: addDays(today, -6), to: today, trip: '' });
    view.innerHTML = `
      <div class="section-title"><h2>Attendance sheet · ${esc(bus)}</h2></div>
      <div class="card">
        <div class="chips mb" id="rp-quick">${[['1d', 'Today'], ['7d', '7 days'], ['1m', '1 month'], ['3m', '3 months'], ['6m', '6 months']].map(([k, l]) => `<button class="chip" data-k="${k}">${l}</button>`).join('')}</div>
        <div class="row" style="align-items:flex-end">
          <label class="field"><span>From</span><input class="input" type="date" id="rp-from" value="${R.from}" min="${minDate}" max="${today}"></label>
          <label class="field"><span>To</span><input class="input" type="date" id="rp-to" value="${R.to}" min="${minDate}" max="${today}"></label>
          <label class="field"><span>Trip</span><select class="input" id="rp-trip"><option value="">Both trips</option><option ${R.trip === 'Morning' ? 'selected' : ''}>Morning</option><option ${R.trip === 'Evening' ? 'selected' : ''}>Evening</option></select></label>
        </div>
        <div class="btn-row"><button class="btn" id="rp-go">${I.chart} Show</button><button class="btn green" id="rp-xl">${I.download} Download Excel</button></div>
        <p class="small muted" style="margin:10px 0 0">The Excel sheet lists each student's name, the date and time, and who marked the attendance (the student with the OTP, or the admin by name). It also has a P/A register and a daily summary. Up to the last 6 months.</p>
      </div>
      <div id="rp-out" class="mt"></div>`;
    const DAYS = { '1d': 0, '7d': 6, '1m': 29, '3m': 89, '6m': 182 };
    const readR = () => { R.from = $('#rp-from').value; R.to = $('#rp-to').value; R.trip = $('#rp-trip').value; };
    $$('#rp-quick [data-k]').forEach((c) => (c.onclick = () => { $$('#rp-quick .chip').forEach((x) => x.classList.toggle('active', x === c)); $('#rp-to').value = today; $('#rp-from').value = addDays(today, -DAYS[c.dataset.k]); show(); }));
    const show = async () => {
      readR();
      const out = $('#rp-out');
      out.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
      try {
        const d = await get(`/api/admin/report?${qs({ bus, from: R.from, to: R.to, trip: R.trip })}`);
        const days = d.daily ? d.daily.slice(-31) : [];
        const max = Math.max(1, ...days.map((x) => Math.max(x.Morning, x.Evening)));
        const byAdmin = d.records.filter((r) => r.method !== 'SELF').length;
        out.innerHTML = `
          <div class="grid stats">
            <div class="card stat blue"><div class="k">Records</div><div class="v">${d.count}</div></div>
            <div class="card stat"><div class="k">Trips held</div><div class="v">${d.tripsHeld}</div></div>
            <div class="card stat green"><div class="k">Avg present / trip</div><div class="v">${d.tripsHeld ? Math.round((d.count / d.tripsHeld) * 10) / 10 : 0}</div></div>
            <div class="card stat orange"><div class="k">Marked by admin</div><div class="v">${byAdmin}</div></div>
          </div>
          ${days.length > 1 ? `<div class="card mt"><h3>Daily attendance</h3><div class="bars">${days.map((x) => `<div class="col" title="${x.date}: Morning ${x.Morning}, Evening ${x.Evening}"><div class="stack">${d.trip !== 'Evening' ? `<i class="m" style="height:${(x.Morning / max) * 100}%"></i>` : ''}${d.trip !== 'Morning' ? `<i class="e" style="height:${(x.Evening / max) * 100}%"></i>` : ''}</div><div class="lbl">${days.length > 14 ? x.date.slice(8) : shortDate(x.date)}</div></div>`).join('')}</div><div class="legend"><span style="--c:var(--blue-2)">Morning</span><span style="--c:var(--orange)">Evening</span></div></div>` : ''}
          <div class="card mt"><h3>Attendance log ${d.count > 500 ? '<span class="small muted">(latest 500 — download Excel for all)</span>' : ''}</h3>
            ${d.records.length ? `<div class="table-wrap" style="max-height:480px"><table class="tbl"><thead><tr><th>Student name</th><th>Enrollment</th><th>Date</th><th>Time</th><th>Trip</th><th>Marked by</th></tr></thead><tbody>${d.records.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.enroll)}</td><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.trip)}</td><td><span class="badge ${r.method === 'SELF' ? 'green' : 'orange'}">${esc(r.markedBy)}</span></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${I.chart}<div>No attendance in this period.</div></div>`}
          </div>`;
      } catch (e) { out.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
    };
    $('#rp-go').onclick = show;
    $('#rp-xl').onclick = async (e) => {
      readR();
      await busy(e.currentTarget, async () => {
        try {
          const res = await fetch(`/api/admin/export?${qs({ bus, from: R.from, to: R.to, trip: R.trip })}`, { headers: { Authorization: 'Bearer ' + S.token } });
          if (!res.ok) { let m = 'Export failed'; try { m = (await res.json()).error; } catch {} throw new Error(m); }
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${bus}_attendance_${R.from}_to_${R.to}.xlsx`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          toast('Excel downloaded', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      });
    };
    show();
  }

  // ---------- admin: chats ----------
  function adminChats(view) {
    const bus = S.adminBus;
    if (S.chatWith) return adminThread(view, S.chatWith);
    view.innerHTML = `<div class="section-title"><h2>Messages from students · ${esc(bus)}</h2></div><div class="card"><div class="list" id="threads"><p class="muted">Loading…</p></div></div>`;
    const load = async () => {
      try {
        const d = await get('/api/admin/chats?bus=' + encodeURIComponent(bus));
        if (!$('#threads')) return;
        const total = d.threads.reduce((a, t) => a + t.unread, 0);
        const badge = $('#chat-badge'); if (badge) { badge.hidden = !total; badge.textContent = total; }
        $('#threads').innerHTML = d.threads.length ? d.threads.map((t) => `<button class="list-item pick" data-e="${esc(t.enroll)}"><div class="avatar ${t.unread ? 'warn' : ''}">${esc(initials(t.name))}</div><div class="li-main"><div class="t">${esc(t.name)}</div><div class="s">${t.lastFrom === 'staff' ? 'Admin: ' : ''}${esc(t.preview)}</div></div><div class="li-side"><span class="small muted">${esc(when(t.lastAt))}</span>${t.unread ? `<span class="badge red">${t.unread} new</span>` : ''}</div></button>`).join('') : `<div class="empty">${I.msg}<div>No messages from students yet.</div></div>`;
        $$('#threads [data-e]').forEach((b) => (b.onclick = () => { S.chatWith = b.dataset.e; render(); }));
      } catch (e) { const t = $('#threads'); if (t) t.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
    };
    setPoll(load, 5000);
  }
  function adminThread(view, enroll) {
    const bus = S.adminBus;
    view.innerHTML = `<div class="card chat-card">
      <div class="chat-head"><button class="icon-btn dark" id="th-back" aria-label="Back">${I.back}</button><div class="li-main"><div class="t" id="th-name">…</div><div class="s" id="th-sub"></div></div></div>
      <div class="chat-body" id="chat-body"><p class="muted center">Loading…</p></div>
      <form class="chat-input" id="th-form"><input class="input" id="th-text" maxlength="1000" placeholder="Reply to the student…" autocomplete="off"><button class="icon-round" id="th-send" aria-label="Send">${I.send}</button></form></div>`;
    $('#th-back').onclick = () => { S.chatWith = null; render(); };
    let count = -1;
    const load = async () => {
      try {
        const d = await get(`/api/admin/chat?${qs({ bus, enroll })}`);
        if (!$('#chat-body')) return;
        $('#th-name').textContent = d.student.name;
        $('#th-sub').textContent = `${d.student.enroll}${d.student.stop ? ' · ' + d.student.stop : ''}`;
        if (d.messages.length === count) return;
        count = d.messages.length;
        const body = $('#chat-body');
        body.innerHTML = d.messages.map((m) => bubble(m, m.from === 'staff')).join('') || '<p class="muted center">No messages.</p>';
        body.scrollTop = body.scrollHeight;
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#th-form').onsubmit = async (e) => {
      e.preventDefault();
      const t = $('#th-text');
      if (!t.value.trim()) return;
      try { await busy($('#th-send'), () => post('/api/admin/chat', { bus, enroll, text: t.value })); t.value = ''; count = -1; load(); } catch (err) { toast(err.message, 'err'); }
    };
    setPoll(load, 4000);
  }

  // ---------- admin: notices, stops, bus ----------
  async function adminNotices(view) {
    const bus = S.adminBus;
    const wide = S.user.role === 'super' || S.user.role === 'transport';
    view.innerHTML = `
      <div class="grid two">
        <div class="card"><h2>Post a notice</h2><p class="sub">Shown to students and coordinators of ${esc(bus)}.</p>
          <form id="nt-form">
            <label class="field"><span>Title</span><input class="input" name="title" maxlength="100" required placeholder="e.g. Bus delayed by 15 minutes"></label>
            <label class="field"><span>Message</span><textarea class="input" name="body" maxlength="1000" required></textarea></label>
            <label class="check"><input type="checkbox" name="pinned"> Pin to top</label>
            ${wide ? '<label class="check"><input type="checkbox" name="allBuses"> Send to all 21 buses</label>' : ''}
            <button class="btn block mt">${I.bell} Post notice</button>
          </form></div>
        <div class="card"><h2>Bus stops</h2><p class="sub">Students see these stops. Renaming a stop updates its students.</p>
          <div id="stops-ed"></div>
          <div class="btn-row mt"><button class="btn sm outline" id="stop-add">${I.plus} Add stop</button><button class="btn sm" id="stop-save">Save stops</button></div>
          <div class="hr"></div>
          <h3>Bus details</h3>
          <form id="bus-form">
            <label class="field"><span>Route description</span><input class="input" name="route"></label>
            <div class="row"><label class="field"><span>Vehicle no.</span><input class="input" name="vehicleNo"></label><label class="field"><span>Driver</span><input class="input" name="driver"></label><label class="field"><span>Driver phone</span><input class="input" name="driverPhone"></label></div>
            <button class="btn sm">Save bus details</button>
          </form>
        </div>
      </div>
      <div class="section-title mt"><h2>What students see</h2></div>
      <div id="preview"></div>`;
    let info;
    try { info = await get('/api/public/info?bus=' + encodeURIComponent(bus)); } catch (e) { toast(e.message, 'err'); return; }
    const stops = info.stops.map((s) => ({ id: s.id, name: s.name, time: s.time }));
    const drawStops = () => {
      $('#stops-ed').innerHTML = stops.map((s, i) => `<div class="stop-edit"><div class="num">${i + 1}</div><input class="input" data-i="${i}" data-k="name" value="${esc(s.name)}" placeholder="Stop name"><input class="input" type="time" data-i="${i}" data-k="time" value="${esc(s.time)}"><div class="mini-btns"><button data-up="${i}" title="Move up">↑</button><button data-down="${i}" title="Move down">↓</button><button data-del="${i}" title="Remove">✕</button></div></div>`).join('') || '<p class="muted small">No stops yet.</p>';
      $$('#stops-ed input').forEach((inp) => (inp.oninput = () => (stops[inp.dataset.i][inp.dataset.k] = inp.value)));
      $$('[data-up]').forEach((b) => (b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]]; drawStops(); } }));
      $$('[data-down]').forEach((b) => (b.onclick = () => { const i = +b.dataset.down; if (i < stops.length - 1) { [stops[i + 1], stops[i]] = [stops[i], stops[i + 1]]; drawStops(); } }));
      $$('[data-del]').forEach((b) => (b.onclick = () => { stops.splice(+b.dataset.del, 1); drawStops(); }));
    };
    drawStops();
    $('#stop-add').onclick = () => { stops.push({ id: '', name: '', time: '' }); drawStops(); $$('#stops-ed input[data-k=name]').pop().focus(); };
    $('#stop-save').onclick = async (e) => { try { await busy(e.currentTarget, () => post('/api/admin/stops', { bus, stops })); toast('Stops saved', 'ok'); adminNotices(view); } catch (err) { toast(err.message, 'err'); } };
    const bf = $('#bus-form');
    ['route', 'vehicleNo', 'driver', 'driverPhone'].forEach((k) => (bf[k].value = info.bus?.[k] || ''));
    bf.onsubmit = async (e) => { e.preventDefault(); try { await busy(bf.querySelector('.btn'), () => post('/api/admin/bus', { bus, route: bf.route.value, vehicleNo: bf.vehicleNo.value, driver: bf.driver.value, driverPhone: bf.driverPhone.value })); toast('Bus details saved', 'ok'); adminNotices(view); } catch (err) { toast(err.message, 'err'); } };
    $('#nt-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try { await busy(f.querySelector('.btn'), () => post('/api/admin/notice', { bus, title: f.title.value, body: f.body.value, pinned: f.pinned.checked, allBuses: f.allBuses?.checked })); toast('Notice posted', 'ok'); adminNotices(view); } catch (err) { toast(err.message, 'err'); }
    };
    infoView($('#preview'), bus);
  }

  // ---------- admin: settings (+ super admin tools) ----------
  function adminSettings(view) {
    const bus = S.adminBus;
    const sup = isSuper();
    view.innerHTML = `
      <div class="grid two">
        <div>
          <div class="card"><h2>Default OTP validity</h2><p class="sub">Pre-filled each time the portal is made live on ${esc(bus)} (you can still change it then).</p>
            <form id="set-form" class="row" style="align-items:flex-end;flex-wrap:nowrap"><label class="field" style="margin:0"><span>Minutes (1–240)</span><input class="input" type="number" min="1" max="240" name="m" id="set-m"></label><button class="btn" style="flex:0 0 auto">Save</button></form>
            <div class="hr"></div>
            <h3>Rules</h3>
            <ul class="small muted rules">
              <li>Only administrative admins and the Super Admin can generate the OTP. If an OTP is already live, others see a popup naming who generated it.</li>
              <li>The portal closes automatically when the OTP time runs out, or when you close it.</li>
              <li>Manual marking works until 1 hour after the OTP expires; after that unmarked students stay absent.</li>
              <li>One phone can mark only one student per trip. Attendance can never be deleted.</li>
            </ul>
          </div>
          <div id="acct" class="mt"></div>
        </div>
        <div class="card"><h2>Activity log</h2><p class="sub">OTP generation, manual marks, exports and changes.</p><div id="audit" class="list" style="max-height:640px;overflow:auto"><p class="muted">Loading…</p></div></div>
      </div>
      ${sup ? `<div class="section-title mt"><h2>Administrative admins &amp; coordinators</h2><button class="btn sm" id="sf-add">${I.plus} Add account</button></div><div class="card"><div id="staff" class="table-wrap"></div></div>
      <div class="section-title mt"><h2>E-mail for password-reset OTPs</h2></div>
      <div class="card"><p class="sub">Use an SMTP account, e.g. a Gmail address with an <i>App password</i> (host smtp.gmail.com, port 465). Until this is set, reset OTPs are printed in the server console.</p>
        <form id="smtp-form"><div class="row"><label class="field"><span>SMTP host</span><input class="input" name="host" placeholder="smtp.gmail.com"></label><label class="field" style="max-width:120px"><span>Port</span><input class="input" name="port" type="number" value="465"></label></div>
        <div class="row"><label class="field"><span>Username / e-mail</span><input class="input" name="user" autocomplete="off"></label><label class="field"><span>Password / app password</span><input class="input" name="pass" type="password" autocomplete="new-password"></label></div>
        <div class="row"><label class="field"><span>From (optional)</span><input class="input" name="from" placeholder="UU Transport <transport@example.com>"></label><label class="field"><span>Send a test e-mail to (optional)</span><input class="input" name="testTo" type="email"></label></div>
        <button class="btn">${I.mail} Save e-mail settings</button></form></div>` : ''}`;
    get(`/api/admin/live?bus=${encodeURIComponent(bus)}`).then((d) => { const i = $('#set-m'); if (i) i.value = d.settings.otpMinutes; }).catch(() => {});
    $('#set-form').onsubmit = async (e) => { e.preventDefault(); try { await busy(e.target.querySelector('.btn'), () => post('/api/admin/settings', { bus, otpMinutes: Number($('#set-m').value) })); toast('Saved', 'ok'); } catch (err) { toast(err.message, 'err'); } };
    accountView($('#acct'));
    $('#acct .acct-head').remove();
    $('#acct .acct-body').classList.remove('mt');
    get('/api/admin/audit?bus=' + encodeURIComponent(bus)).then((d) => {
      const a = $('#audit'); if (!a) return;
      a.innerHTML = d.audit.length ? d.audit.map((x) => `<div class="list-item"><div class="li-main"><div class="t" style="white-space:normal;font-size:13.5px">${esc(x.action.replace(/-/g, ' '))}${x.detail ? ' — <span class="muted" style="font-weight:400">' + esc(x.detail) + '</span>' : ''}</div><div class="s">${esc(x.user)} · ${esc(when(x.at))}</div></div></div>`).join('') : '<p class="muted">No activity yet.</p>';
    }).catch((e) => { const a = $('#audit'); if (a) a.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; });
    if (!sup) return;
    const loadStaff = async () => {
      const { staff } = await get('/api/super/staff');
      $('#staff').innerHTML = `<table class="tbl"><thead><tr><th>Role</th><th>Name</th><th>Login ID</th><th>Bus</th><th>Phone</th><th>E-mail</th><th>Status</th><th></th></tr></thead><tbody>${staff.filter((s) => s.role !== 'super').map((s) => `<tr><td>${esc(s.title)}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.username)}</td><td>${s.bus === '*' ? 'All' : esc(s.bus)}</td><td>${esc(s.phone)}</td><td>${esc(s.email) || '<span class="muted">—</span>'}</td><td>${s.active ? '<span class="badge green">Active</span>' : '<span class="badge gray">Disabled</span>'}</td><td><button class="btn sm outline" data-sf="${esc(s.username)}">Edit</button></td></tr>`).join('')}</tbody></table>`;
      $$('[data-sf]').forEach((b) => (b.onclick = () => staffModal(staff.find((x) => x.username === b.dataset.sf), loadStaff)));
    };
    $('#sf-add').onclick = () => staffModal(null, loadStaff);
    loadStaff().catch((e) => toast(e.message, 'err'));
    const sf = $('#smtp-form');
    let locked = false;
    get('/api/super/smtp').then((c) => {
      sf.host.value = c.host; sf.port.value = c.port; sf.user.value = c.user; sf.from.value = c.from; sf.pass.placeholder = c.hasPass ? '•••••••• (saved)' : '';
      locked = c.locked;
      const status = c.host && c.user && c.hasPass
        ? `<div class="alert ok">E-mail is configured: OTPs are sent through <b>${esc(c.host)}</b> as <b>${esc(c.user)}</b> (set in ${esc(c.source)}).</div>`
        : '<div class="alert warn">E-mail is not configured yet. Reset OTPs are printed in the server console until it is.</div>';
      sf.insertAdjacentHTML('afterbegin', status);
      if (locked) {
        ['host', 'port', 'user', 'pass', 'from'].forEach((k) => (sf[k].disabled = true));
        sf.querySelector('.btn').innerHTML = `${I.mail} Send test e-mail`;
      }
    }).catch(() => {});
    sf.onsubmit = async (e) => {
      e.preventDefault();
      if (locked && !sf.testTo.value) return toast('Enter an e-mail address to send the test to', 'err');
      const body = locked ? { testOnly: true, testTo: sf.testTo.value } : { host: sf.host.value, port: sf.port.value, user: sf.user.value, pass: sf.pass.value, from: sf.from.value, testTo: sf.testTo.value };
      try { const r = await busy(sf.querySelector('.btn'), () => post('/api/super/smtp', body)); sf.pass.value = ''; toast(r.tested ? 'Test e-mail sent — check the inbox' : 'E-mail settings saved', 'ok'); } catch (err) { toast(err.message, 'err'); }
    };
  }

  function staffModal(s, done) {
    const isNew = !s;
    s = s || { username: '', name: '', role: 'busincharge', bus: S.adminBus, phone: '', email: '', title: '', active: true };
    modal(`<h2>${isNew ? 'Add admin / coordinator' : 'Edit account'}</h2>
      ${isNew ? '<p class="muted small">A random login ID and password will be created and shown once.</p>' : `<p class="muted small">Login ID: <b>${esc(s.username)}</b></p>`}
      <form id="sf-form">
        <label class="field"><span>Full name</span><input class="input" name="name" value="${esc(s.name)}" required></label>
        <div class="row">
          <label class="field"><span>Role</span><select class="input" name="role">${[['busincharge', 'Bus Incharge / faculty coordinator'], ['transport', 'Transport Incharge (all buses)'], ['coordinator', 'Student Coordinator']].map(([v, l]) => `<option value="${v}" ${s.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Bus</span><select class="input" name="bus">${Array.from({ length: 21 }, (_, i) => `UU-${i + 1}`).map((b) => `<option ${b === s.bus ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Display title</span><input class="input" name="title" value="${esc(s.title)}" placeholder="e.g. Student Coordinator (Girl)"></label>
        <div class="row"><label class="field"><span>Phone</span><input class="input" name="phone" value="${esc(s.phone)}"></label><label class="field"><span>E-mail (for OTP reset)</span><input class="input" type="email" name="email" value="${esc(s.email)}"></label></div>
        <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Account active</label>
        <div class="btn-row mt"><button type="button" class="btn outline" data-close style="flex:1">Cancel</button><button class="btn" style="flex:1" id="sf-save">Save</button></div>
        ${isNew ? '' : `<div class="hr"></div><button type="button" class="btn sm outline" id="sf-reset">${I.key} Generate new password</button>`}
      </form>`, (m, close) => {
      $('#sf-form', m).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          const r = await busy($('#sf-save', m), () => post('/api/super/staff/save', { username: s.username || undefined, name: f.name.value, role: f.role.value, bus: f.bus.value, title: f.title.value, phone: f.phone.value, email: f.email.value, active: f.active.checked }));
          close(); done();
          if (r.password) credsModal('Account created', r.username, r.password); else toast('Account saved', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      };
      const rb = $('#sf-reset', m);
      if (rb) rb.onclick = async () => {
        try { const r = await post('/api/super/staff/reset', { username: s.username }); close(); credsModal('New password generated', r.username, r.password); } catch (err) { toast(err.message, 'err'); }
      };
    });
  }

  // ---------- boot ----------
  async function boot() {
    const started = Date.now();
    if (S.token) {
      try { const r = await get('/api/me'); S.user = r.user; } catch { S.token = null; store.del('token'); }
    }
    const wait = Math.max(0, 1600 - (Date.now() - started));
    setTimeout(() => {
      render();
      $('#splash').classList.add('hide');
      setTimeout(() => $('#splash').remove(), 500);
    }, wait);
  }
  boot();
})();
