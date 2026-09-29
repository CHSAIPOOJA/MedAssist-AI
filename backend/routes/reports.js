const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { analyzeReport } = require("../utils/analyzeReport");

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(["application/pdf", "text/plain", "image/png", "image/jpeg"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Unsupported file type. Upload a PDF, TXT, PNG, or JPG."));
    }
    cb(null, true);
  },
});

/**
 * POST /api/reports — upload a report, then run the full analysis
 * (read text -> chunks + embeddings -> metrics -> specialist -> AI summary).
 */
router.post("/", requireAuth, upload.single("report"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Attach a report file to upload." });
  }

  const insert = db
    .prepare(
      `INSERT INTO reports (user_id, original_name, stored_name, mime_type, status)
       VALUES (?, ?, ?, ?, 'processing')`
    )
    .run(req.user.id, req.file.originalname, req.file.filename, req.file.mimetype);

  const report = await analyzeReport(Number(insert.lastInsertRowid), req.user.id);
  res.status(201).json({ report });
});

/** POST /api/reports/:id/reprocess — "Retry analysis" on an existing report. */
router.post("/:id/reprocess", requireAuth, async (req, res) => {
  const report = await analyzeReport(Number(req.params.id), req.user.id);
  if (!report) return res.status(404).json({ error: "Report not found." });
  res.json({ report });
});

router.get("/", requireAuth, (req, res) => {
  const reports = db
    .prepare(
      `SELECT id, original_name, mime_type, summary, specialist, status, uploaded_at
       FROM reports WHERE user_id = ? ORDER BY uploaded_at DESC`
    )
    .all(req.user.id);
  res.json({ reports });
});

router.get("/:id", requireAuth, (req, res) => {
  const report = db
    .prepare("SELECT * FROM reports WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!report) return res.status(404).json({ error: "Report not found." });

  const metrics = db
    .prepare("SELECT metric_name, metric_value, unit FROM health_metrics WHERE report_id = ?")
    .all(report.id);

  res.json({ report, metrics });
});

router.delete("/:id", requireAuth, (req, res) => {
  const report = db
    .prepare("SELECT * FROM reports WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!report) return res.status(404).json({ error: "Report not found." });

  const filePath = path.join(UPLOAD_DIR, report.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare("DELETE FROM reports WHERE id = ?").run(report.id);
  res.status(204).end();
});

module.exports = router;
