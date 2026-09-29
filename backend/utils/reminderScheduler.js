// reminderScheduler.js — emails people when it's time to take their medicine.
//
// Every 30 seconds it looks for medicines whose time has just arrived
// (or arrived up to GRACE_MINUTES ago, in case the app was busy) and that
// haven't been emailed yet today. Medicines due for the same person at the
// same time go out together in one email. Times are the computer's local time.
//
// NOTE: emails are only sent while the MedAssist server is running.

const db = require("../db");
const { parseTimes, formatTime12 } = require("./timeParser");
const mailer = require("./mailer");

const GRACE_MINUTES = 10;
const CHECK_EVERY_MS = 30 * 1000;

const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Which reminder emails are due right now? Pure lookup — sends nothing. */
function findDue(now = new Date(), grace = GRACE_MINUTES) {
  const today = localDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const rows = db
    .prepare(
      `SELECT m.id, m.user_id, m.name, m.dosage, m.notes, m.time_of_day, m.start_date, m.end_date,
              u.email, u.name AS user_name
       FROM medicines m JOIN users u ON u.id = m.user_id
       WHERE m.active = 1 AND m.time_of_day IS NOT NULL AND TRIM(m.time_of_day) <> ''`
    )
    .all();

  const alreadySent = new Set(
    db
      .prepare("SELECT medicine_id, due_time FROM reminder_log WHERE due_date = ?")
      .all(today)
      .map((r) => `${r.medicine_id}|${r.due_time}`)
  );

  const groups = new Map(); // one email per person per time
  for (const med of rows) {
    if (med.start_date && today < med.start_date) continue;
    if (med.end_date && today > med.end_date) continue;

    for (const time of parseTimes(med.time_of_day)) {
      const [h, m] = time.split(":").map(Number);
      const late = nowMin - (h * 60 + m);
      if (late < 0 || late > grace) continue; // not yet, or too long ago
      if (alreadySent.has(`${med.id}|${time}`)) continue;

      const key = `${med.user_id}|${time}`;
      if (!groups.has(key)) {
        groups.set(key, { userId: med.user_id, email: med.email, userName: med.user_name, time, date: today, meds: [] });
      }
      groups.get(key).meds.push(med);
    }
  }
  return [...groups.values()];
}

function buildEmail(group) {
  const label = (m) => (m.dosage ? `${m.name} (${m.dosage})` : m.name);
  const names = group.meds.map(label);
  const when = formatTime12(group.time);
  const first = (group.userName || "there").split(" ")[0];

  const subject = `Medicine reminder (${when}): ${names.join(", ")}`;

  const text =
    `Hi ${first},\n\nIt's ${when} - time to take:\n\n` +
    group.meds.map((m) => `  - ${label(m)}${m.notes ? ` - ${m.notes}` : ""}`).join("\n") +
    `\n\nFollow your doctor's instructions. This is an automatic reminder from MedAssist AI, not medical advice.\n`;

  const html =
    `<div style="font-family:Arial,sans-serif;max-width:480px;color:#13251F">` +
    `<h2 style="margin:0 0 8px">Time for your medicine</h2>` +
    `<p style="margin:0 0 12px;color:#48605A">Hi ${esc(first)}, it's <b>${when}</b>. Please take:</p>` +
    `<ul style="padding-left:18px">` +
    group.meds
      .map((m) => `<li><b>${esc(label(m))}</b>${m.notes ? ` &mdash; ${esc(m.notes)}` : ""}</li>`)
      .join("") +
    `</ul><p style="font-size:12px;color:#7C897F">Follow your doctor's instructions. Automatic reminder from MedAssist AI - not medical advice.</p></div>`;

  return { subject, text, html };
}

let running = false;
let lastError = null;

/** Sends every reminder that is due. Safe to call repeatedly. */
async function tick(now = new Date()) {
  if (running) return { sent: 0, skipped: "busy" };
  if (!mailer.isConfigured()) return { sent: 0, skipped: "email not set up" };
  running = true;
  let sent = 0;
  try {
    const log = db.prepare(
      "INSERT OR IGNORE INTO reminder_log (medicine_id, due_date, due_time) VALUES (?, ?, ?)"
    );
    for (const group of findDue(now)) {
      try {
        await mailer.sendMail({ to: group.email, ...buildEmail(group) });
        group.meds.forEach((m) => log.run(m.id, group.date, group.time));
        sent++;
        lastError = null;
        console.log(`Reminder sent to ${group.email} for ${formatTime12(group.time)}: ${group.meds.map((m) => m.name).join(", ")}`);
      } catch (err) {
        // not logged, so the next check (within the grace window) retries it
        lastError = err.message;
        console.warn(`Reminder email to ${group.email} failed: ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
  return { sent };
}

let timer = null;
function start() {
  if (timer) return timer;
  tick().catch((e) => console.warn("Reminder check failed:", e.message));
  timer = setInterval(() => tick().catch((e) => console.warn("Reminder check failed:", e.message)), CHECK_EVERY_MS);
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { findDue, buildEmail, tick, start, stop, getLastError: () => lastError, GRACE_MINUTES };
