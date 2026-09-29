const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { parseTimes, formatTime12 } = require("../utils/timeParser");
const mailer = require("../utils/mailer");

const router = express.Router();

// adds the clock times the app understood from the free-text "time of day"
const withTimes = (m) => {
  const times = parseTimes(m.time_of_day);
  return { ...m, times, times_display: times.map(formatTime12) };
};

// Is email set up, and where will reminders go?
router.get("/email-status", requireAuth, (req, res) => {
  res.json({
    configured: mailer.isConfigured(),
    from: mailer.isConfigured() ? process.env.SMTP_USER : null,
    to: req.user.email,
  });
});

// Sends a test email to the signed-in user so they can check it works.
router.post("/test-email", requireAuth, async (req, res) => {
  try {
    await mailer.sendMail({
      to: req.user.email,
      subject: "MedAssist AI - test email",
      text: "This is a test. If you can read this, your medicine reminder emails are working.",
      html: "<p>This is a test. If you can read this, your <b>medicine reminder emails</b> are working.</p>",
    });
    res.json({ ok: true, to: req.user.email });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get("/", requireAuth, (req, res) => {
  const medicines = db
    .prepare(
      `SELECT * FROM medicines WHERE user_id = ? ORDER BY active DESC, created_at DESC`
    )
    .all(req.user.id);
  res.json({ medicines: medicines.map(withTimes) });
});

router.post("/", requireAuth, (req, res) => {
  const { name, dosage, frequency, time_of_day, start_date, end_date, notes } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Medicine name is required." });
  }

  const info = db
    .prepare(
      `INSERT INTO medicines (user_id, name, dosage, frequency, time_of_day, start_date, end_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      name.trim(),
      dosage || null,
      frequency || null,
      time_of_day || null,
      start_date || null,
      end_date || null,
      notes || null
    );

  const medicine = db.prepare("SELECT * FROM medicines WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ medicine: withTimes(medicine) });
});

router.patch("/:id", requireAuth, (req, res) => {
  const existing = db
    .prepare("SELECT * FROM medicines WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Reminder not found." });

  const fields = ["name", "dosage", "frequency", "time_of_day", "start_date", "end_date", "notes", "active"];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (field in (req.body || {})) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  values.push(existing.id);
  db.prepare(`UPDATE medicines SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  const medicine = db.prepare("SELECT * FROM medicines WHERE id = ?").get(existing.id);
  res.json({ medicine: withTimes(medicine) });
});

router.delete("/:id", requireAuth, (req, res) => {
  const existing = db
    .prepare("SELECT * FROM medicines WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Reminder not found." });

  db.prepare("DELETE FROM medicines WHERE id = ?").run(existing.id);
  res.status(204).end();
});

module.exports = router;
