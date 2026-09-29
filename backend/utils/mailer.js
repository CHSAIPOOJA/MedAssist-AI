// mailer.js — sends email through SMTP (Gmail by default) using nodemailer.

let transport = null;

const isConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

// Strict on purpose: no quotes, brackets, parentheses or comments, so a
// crafted address can never be parsed into a different recipient.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const isValidEmail = (s) => typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s);

function getTransport() {
  if (transport) return transport;
  const nodemailer = require("nodemailer"); // loaded only when needed
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

/** Turns cryptic SMTP errors into plain English. */
function explainMailError(err) {
  const code = err && err.code;
  const msg = (err && err.message) || String(err);
  if (code === "EAUTH" || /invalid login|username and password not accepted|535/i.test(msg)) {
    return "Gmail rejected the login. Use a 16-letter App Password (needs 2-Step Verification on the Google account), not your normal password.";
  }
  if (["ESOCKET", "ECONNECTION", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EDNS"].includes(code)) {
    return "Couldn't connect to the email server. Check your internet, or a firewall/college network blocking ports 465/587.";
  }
  return msg;
}

async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) {
    throw new Error('Email is not set up. Run "npm run setup:email" in the backend folder, then restart.');
  }
  if (!isValidEmail(to)) {
    throw new Error(`"${to}" is not a valid email address.`);
  }
  try {
    return await getTransport().sendMail({
      from: process.env.MAIL_FROM || `MedAssist AI <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    const friendly = new Error(explainMailError(err));
    friendly.cause = err;
    throw friendly;
  }
}

/** For tests: replace the real SMTP transport with a fake. */
function setTransport(t) {
  transport = t;
}

module.exports = { isConfigured, isValidEmail, sendMail, explainMailError, setTransport };
