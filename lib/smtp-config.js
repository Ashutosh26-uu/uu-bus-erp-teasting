// SMTP settings for password-reset OTP e-mails.
// Priority: environment variables → smtp.config.json (project root, git-ignored) → Super Admin settings screen.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'smtp.config.json');

function fromEnv() {
  if (!process.env.SMTP_HOST) return null;
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
    source: 'environment variables',
  };
}

function fromFile() {
  if (!fs.existsSync(FILE)) return null;
  let c;
  try { c = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {
    console.error('smtp.config.json is not valid JSON:', e.message);
    return null;
  }
  if (!c.host || !c.user || !c.pass || /^YOUR_|^PASTE_/i.test(c.user + c.pass)) return null;
  return { host: c.host, port: Number(c.port) || 465, user: c.user, pass: String(c.pass).replace(/\s+/g, ''), from: c.from || '', source: 'smtp.config.json' };
}

// Returns the config to use, or null if nothing is configured.
function externalSmtp() {
  return fromEnv() || fromFile();
}

// Turn raw SMTP errors into advice an admin can act on.
function explainSmtpError(msg) {
  const m = String(msg);
  if (/535|534|Username and Password not accepted|BadCredentials|authentication failed/i.test(m))
    return 'Login rejected by the mail server. For Gmail, use a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords), not the normal password.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return 'Mail server address not found. Check the SMTP host name and the internet connection.';
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) return 'Could not connect to the mail server. Check the host/port (Gmail: smtp.gmail.com, 465) and that the network allows outgoing mail.';
  if (/certificate|SSL|TLS|wrong version/i.test(m)) return 'Secure connection failed. Use port 465 for SSL, or 587 for STARTTLS.';
  if (/550|553|sender|not owned/i.test(m)) return 'The mail server refused the sender address. Leave "from" empty or use the same address as the SMTP user.';
  return m;
}

module.exports = { externalSmtp, explainSmtpError, SMTP_FILE: FILE };
