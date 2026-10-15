// Minimal SMTP client (no dependencies). Supports implicit TLS (port 465) and
// STARTTLS (port 587/25) with AUTH LOGIN — works with Gmail app passwords,
// Outlook/Office365, Zoho, etc.
const tls = require('tls');
const net = require('net');

function reader(sock) {
  let buf = '';
  const waiters = [];
  let error = null;
  const pump = () => {
    while (waiters.length) {
      const m = buf.match(/(^|\r\n)(\d{3}) [^\r\n]*\r\n/);
      if (!m) return;
      const end = m.index + m[0].length;
      const text = buf.slice(0, end);
      buf = buf.slice(end);
      waiters.shift().resolve({ code: Number(m[2]), text });
    }
  };
  const onData = (d) => { buf += d.toString('utf8'); pump(); };
  const onErr = (e) => { error = e; while (waiters.length) waiters.shift().reject(e); };
  sock.on('data', onData);
  sock.on('error', onErr);
  sock.on('close', () => onErr(new Error('SMTP connection closed')));
  return {
    read() {
      return new Promise((resolve, reject) => {
        if (error) return reject(error);
        waiters.push({ resolve, reject });
        pump();
      });
    },
    detach() { sock.removeListener('data', onData); sock.removeAllListeners('error'); sock.removeAllListeners('close'); },
  };
}

async function cmd(sock, r, line, expect) {
  if (line !== null) sock.write(line + '\r\n');
  const res = await r.read();
  const ok = Array.isArray(expect) ? expect.includes(res.code) : res.code === expect;
  if (!ok) throw new Error(`SMTP error after "${(line || 'connect').split(' ')[0]}": ${res.text.trim()}`);
  return res;
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

function connect(host, port, secure) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setTimeout(20000, () => sock.destroy(new Error('SMTP timeout')));
    sock.once(secure ? 'secureConnect' : 'connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

async function sendMail(cfg, { to, subject, text, html }) {
  const host = cfg.host;
  const port = Number(cfg.port) || 465;
  const secure = cfg.secure !== undefined ? !!cfg.secure : port === 465;
  let sock = await connect(host, port, secure);
  let r = reader(sock);
  try {
    await cmd(sock, r, null, 220);
    let ehlo = await cmd(sock, r, 'EHLO uu-bus-erp', 250);
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await cmd(sock, r, 'STARTTLS', 220);
      r.detach();
      sock = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: host }, () => resolve(t));
        t.once('error', reject);
      });
      sock.setTimeout(20000, () => sock.destroy(new Error('SMTP timeout')));
      r = reader(sock);
      ehlo = await cmd(sock, r, 'EHLO uu-bus-erp', 250);
    }
    if (cfg.user) {
      await cmd(sock, r, 'AUTH LOGIN', 334);
      await cmd(sock, r, b64(cfg.user), 334);
      await cmd(sock, r, b64(cfg.pass || ''), 235);
    }
    const from = cfg.from || cfg.user;
    const fromAddr = (from.match(/<([^>]+)>/) || [, from])[1];
    await cmd(sock, r, `MAIL FROM:<${fromAddr}>`, 250);
    await cmd(sock, r, `RCPT TO:<${to}>`, [250, 251]);
    await cmd(sock, r, 'DATA', 354);
    const boundary = 'b' + Date.now().toString(36);
    const body = [
      `From: ${from.includes('<') ? from : `"UU Bus ERP" <${from}>`}`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@uu-bus-erp>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(text).replace(/.{76}/g, '$&\r\n'),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(html || text).replace(/.{76}/g, '$&\r\n'),
      `--${boundary}--`,
      '',
    ].join('\r\n');
    await cmd(sock, r, body + '\r\n.', 250);
    sock.write('QUIT\r\n');
  } finally {
    setTimeout(() => sock.destroy(), 500);
  }
}

module.exports = { sendMail };
