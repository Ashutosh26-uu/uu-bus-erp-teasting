// Sends a test OTP e-mail using the same settings the server uses.
// Usage: node scripts/test-email.js someone@example.com
const { sendMail } = require('../lib/mailer');
const { externalSmtp, explainSmtpError, SMTP_FILE } = require('../lib/smtp-config');

const to = process.argv[2];
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.log('Usage: node scripts/test-email.js someone@example.com');
  process.exit(1);
}
const cfg = externalSmtp();
if (!cfg) {
  console.log(`E-mail is not configured. Fill in "user" and "pass" in:\n  ${SMTP_FILE}`);
  process.exit(1);
}
const otp = String(Math.floor(100000 + Math.random() * 900000));
console.log(`Sending a test OTP via ${cfg.host}:${cfg.port} as ${cfg.user} to ${to} …`);
sendMail(cfg, {
  to,
  subject: `UU Bus ERP test OTP: ${otp}`,
  text: `This is a test from UU Bus ERP. Sample OTP: ${otp}\nIf you received this, password-reset OTP e-mails are working.`,
  html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e3e7f2;border-radius:12px;overflow:hidden"><div style="background:#0d2c8c;color:#fff;padding:16px 20px;font-size:18px;font-weight:bold">United University · Bus ERP</div><div style="padding:20px"><p>This is a test e-mail. Sample OTP:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0d2c8c;margin:10px 0">${otp}</p><p style="color:#646b8a">If you received this, password-reset OTP e-mails are working.</p></div></div>`,
})
  .then(() => console.log('✔ Sent. Check the inbox (and the spam folder).'))
  .catch((e) => { console.log('✘ Failed:', explainSmtpError(e.message)); process.exit(1); });
