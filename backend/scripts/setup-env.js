// setup-env.js — creates/repairs backend/.env so you never have to edit it by hand.
//   * generates a random JWT_SECRET if it's missing or still the template text
//   * asks for your Gemini API key if it's missing, and checks it with Google
//   * cleans common mistakes (quotes, spaces, "JWT_SECRET=JWT_SECRET=...")
// Run automatically by start.bat, or manually with:  npm run setup

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");
const { explainMailError, isValidEmail } = require("../utils/mailer");

const ENV_PATH = path.join(__dirname, "..", ".env");

const DEFAULT_TEMPLATE = `PORT=4000
JWT_SECRET=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMS=768
`;

function cleanValue(name, raw) {
  let v = (raw || "").trim();
  v = v.replace(/^["']|["']$/g, "").trim();
  if (v.toUpperCase().startsWith(name.toUpperCase() + "=")) v = v.slice(name.length + 1).trim();
  return v;
}

function parseEnv(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m) map[m[1]] = cleanValue(m[1], m[2]);
  }
  return map;
}

function isPlaceholder(v) {
  return !v || /^(your_|change_this|paste|xxx)/i.test(v) || /_here$/i.test(v);
}

/** Sets KEY=value lines in env text, keeping comments and other lines. */
function upsertEnv(text, updates) {
  let out = text.replace(/\r\n/g, "\n");
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
    if (re.test(out)) out = out.replace(re, `${key}=${value}`);
    else out = out.replace(/\n*$/, "\n") + `${key}=${value}\n`;
  }
  return out;
}

/**
 * Asks Google whether the key works. Returns { ok, message }:
 *   ok === true   Google accepted it
 *   ok === false  Google itself said the key is bad (a real Google error body)
 *   ok === null   couldn't tell — offline, or a firewall/proxy answered instead
 *                 of Google (common on college networks). Never blocks the user.
 */
async function validateKey(key, fetchFn = fetch) {
  try {
    const res = await fetchFn("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: { "x-goog-api-key": key },
    });
    if (res.ok) return { ok: true, message: "Google accepted the key." };
    const data = await res.json().catch(() => null);
    if (data && data.error && data.error.message) {
      return { ok: false, message: data.error.message };
    }
    return { ok: null, message: "Couldn't verify the key (network/firewall) - saving it anyway." };
  } catch (err) {
    return { ok: null, message: "Couldn't reach Google to verify the key - saving it anyway." };
  }
}

/** Google shows App Passwords as "abcd efgh ijkl mnop" - keep just the letters. */
function cleanAppPassword(raw) {
  return String(raw || "").replace(/[\s"']/g, "");
}

/**
 * Tries logging in to Gmail with the App Password.
 *   ok true  = accepted   ok false = Google refused the login
 *   ok null  = couldn't tell (offline / firewall / package not installed yet)
 */
async function verifyEmail({ user, pass }, nodemailerLib) {
  let nm = nodemailerLib;
  if (!nm) {
    try { nm = require("nodemailer"); } catch (e) {
      return { ok: null, message: "Couldn't check the login yet (run npm install first) - saving it anyway." };
    }
  }
  try {
    const t = nm.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
      connectionTimeout: 15000, greetingTimeout: 15000,
    });
    await t.verify();
    return { ok: true, message: "Gmail accepted the login." };
  } catch (err) {
    const definite = err.code === "EAUTH" || /invalid login|535/i.test(err.message || "");
    const why = explainMailError(err);
    return { ok: definite ? false : null, message: definite ? why : `${why} (saving it anyway)` };
  }
}

function makeAsker() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on("close", () => (closed = true));
  const ask = (q) =>
    new Promise((resolve) => {
      if (closed) return resolve(null);
      rl.question(q, resolve);
      rl.once("close", () => resolve(null));
    });
  return { ask, close: () => rl.close() };
}

async function main() {
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : DEFAULT_TEMPLATE;
  const env = parseEnv(text);
  const updates = {};

  if (isPlaceholder(env.JWT_SECRET)) {
    updates.JWT_SECRET = crypto.randomBytes(24).toString("hex");
    console.log("• Generated a secure JWT_SECRET for you.");
  } else if (env.JWT_SECRET !== (text.match(/^\s*JWT_SECRET\s*=(.*)$/m) || [])[1]?.trim()) {
    updates.JWT_SECRET = env.JWT_SECRET; // repaired formatting
  }

  let asker = null;
  const getAsker = () => (asker = asker || makeAsker());

  let key = env.GEMINI_API_KEY;
  if (isPlaceholder(key)) {
    const { ask } = getAsker();
    console.log("\nGet a FREE key at https://aistudio.google.com/apikey (Create API key -> copy).");
    let lastRejected = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const answer = cleanValue("GEMINI_API_KEY", await ask("Paste your Gemini API key and press Enter (or just Enter to skip AI): "));
      if (!answer) { key = ""; break; }
      if (answer === lastRejected) {
        key = answer;
        console.log("  Saving that key as you entered it twice.");
        break;
      }
      const check = await validateKey(answer);
      console.log(check.ok === false ? `  x Google says: ${check.message}` : `  ok ${check.message}`);
      if (check.ok !== false) { key = answer; break; }
      lastRejected = answer;
      console.log("  Copy the key again from Google AI Studio (paste the same key again to save it anyway).");
    }
    if (key) updates.GEMINI_API_KEY = key;
    else console.log("• Continuing without AI. Run 'npm run setup' later to add a key.");
  } else if (env.GEMINI_API_KEY !== (text.match(/^\s*GEMINI_API_KEY\s*=(.*)$/m) || [])[1]?.trim()) {
    updates.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }

  // ---- optional: email reminders (Gmail + App Password) ----
  const force = process.argv.includes("--email");
  const emailMissing = isPlaceholder(env.SMTP_USER) || isPlaceholder(env.SMTP_PASS);
  if (force || (emailMissing && env.SKIP_EMAIL_SETUP !== "1")) {
    const { ask } = getAsker();
    console.log(`
Email reminders (optional): MedAssist can email you when it's time to take a medicine.
You need a Gmail account with 2-Step Verification turned on. Then:
  1. Open https://myaccount.google.com/apppasswords
  2. Create an app password (call it MedAssist) and copy the 16 letters.`);
    const rawUser = await ask("Your Gmail address (or just Enter to skip email reminders): ");
    const user = cleanValue("SMTP_USER", rawUser);

    if (!user) {
      // Enter pressed = "no thanks, don't ask again"; no input at all = leave as is
      if (rawUser !== null && !force) updates.SKIP_EMAIL_SETUP = "1";
      console.log("• Skipping email reminders. Run 'npm run setup:email' any time to add them.");
    } else if (!isValidEmail(user)) {
      console.log(`x "${user}" doesn't look like an email address. Run 'npm run setup:email' to try again.`);
    } else {
      let pass = "";
      let lastRejected = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const answer = cleanAppPassword(await ask("Paste the 16-letter App Password: "));
        if (!answer) break;
        if (answer === lastRejected) { pass = answer; console.log("  Saving that password as you entered it twice."); break; }
        if (!/^[a-z]{16}$/i.test(answer)) {
          console.log("  x That isn't 16 letters. Copy it again from Google (paste the same one again to keep it).");
          lastRejected = answer;
          continue;
        }
        const check = await verifyEmail({ user, pass: answer });
        console.log(check.ok === false ? `  x ${check.message}` : `  ok ${check.message}`);
        if (check.ok !== false) { pass = answer; break; }
        lastRejected = answer;
      }
      if (pass) {
        Object.assign(updates, {
          SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: user, SMTP_PASS: pass, SKIP_EMAIL_SETUP: "0",
        });
        console.log("• Email reminders will be sent from " + user + " (restart the app to apply).");
      } else {
        console.log("• Email reminders not set up. Run 'npm run setup:email' to try again.");
      }
    }
  }
  if (asker) asker.close();

  if (Object.keys(updates).length > 0 || !fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, upsertEnv(text, updates), "utf8");
    console.log("• Saved backend/.env");
  } else {
    console.log("• backend/.env unchanged.");
  }
}

module.exports = { cleanValue, parseEnv, isPlaceholder, upsertEnv, validateKey, cleanAppPassword, verifyEmail };

if (require.main === module) {
  main().catch((err) => {
    console.error("Setup failed:", err.message);
    process.exit(1);
  });
}
