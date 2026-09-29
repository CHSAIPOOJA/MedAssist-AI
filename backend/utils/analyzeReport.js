// analyzeReport.js — the full pipeline for one uploaded report:
//   read text (PDF / TXT / scan via Gemini) -> chunk -> embed (vector index)
//   -> lab metrics -> specialist -> AI summary
// Used by both "upload" and "Retry analysis". Anything that goes wrong is
// saved on the report (error_message) so the UI can say exactly why.

const path = require("path");
const db = require("../db");
const { extractText } = require("./pdfExtract");
const { chunkText } = require("./rag");
const { extractMetrics } = require("./metrics");
const { recommendSpecialist } = require("./specialistRules");
const { complete } = require("./aiClient");
const { indexReport } = require("./vectorStore");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

const SUMMARY_SYSTEM_PROMPT = `You are MedAssist AI, a healthcare report explainer.
Explain the medical report in plain, reassuring language a non-expert can understand.
Rules:
- Do NOT provide a diagnosis or tell the person what disease they have.
- Highlight the important observations and anything notably outside a normal range.
- Explain medical terms in simple words as you use them.
- Close by reminding the reader to discuss the report with a qualified healthcare professional.
- Keep it under 200 words, in short paragraphs or bullet points.`;

async function analyzeReport(reportId, userId, deps = {}) {
  const report = db
    .prepare("SELECT * FROM reports WHERE id = ? AND user_id = ?")
    .get(reportId, userId);
  if (!report) return null;

  // Start clean so "Retry analysis" never duplicates chunks or metrics.
  db.prepare("DELETE FROM report_chunks WHERE report_id = ?").run(reportId);
  db.prepare("DELETE FROM health_metrics WHERE report_id = ?").run(reportId);
  db.prepare(
    "UPDATE reports SET status = 'processing', summary = NULL, error_message = NULL WHERE id = ?"
  ).run(reportId);

  try {
    const filePath = path.join(UPLOAD_DIR, report.stored_name);
    const { text, method, reason } = await extractText(filePath, report.mime_type, deps);

    let summary = null;
    let note = reason || null; // why nothing could be read, if that happened
    let specialist = { specialist: null, reason: null };

    if (text) {
      const insertChunk = db.prepare(
        "INSERT INTO report_chunks (report_id, chunk_index, chunk_text) VALUES (?, ?, ?)"
      );
      chunkText(text).forEach((c, i) => insertChunk.run(reportId, i, c));

      // Vector index for semantic search. If it fails, chat falls back to TF-IDF.
      try {
        await indexReport(reportId);
      } catch (embedErr) {
        console.warn("Embedding index skipped:", embedErr.message);
      }

      const insertMetric = db.prepare(
        `INSERT INTO health_metrics (user_id, report_id, metric_name, metric_value, unit)
         VALUES (?, ?, ?, ?, ?)`
      );
      extractMetrics(text).forEach((m) =>
        insertMetric.run(userId, reportId, m.name, m.value, m.unit)
      );

      specialist = recommendSpecialist(text);

      try {
        summary = await complete({
          system: SUMMARY_SYSTEM_PROMPT,
          prompt: `Report text:\n\n${text.slice(0, 12000)}`,
          maxTokens: 1024,
        });
      } catch (aiErr) {
        note = `The report was read, but the AI summary failed: ${aiErr.message}`;
      }
    }

    db.prepare(
      `UPDATE reports
       SET extracted_text = ?, summary = ?, specialist = ?, specialist_reason = ?,
           extraction_method = ?, error_message = ?, status = 'ready'
       WHERE id = ?`
    ).run(text, summary, specialist.specialist, specialist.reason, method, note, reportId);
  } catch (err) {
    db.prepare("UPDATE reports SET status = 'failed', error_message = ? WHERE id = ?").run(
      err.message,
      reportId
    );
  }

  return db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId);
}

module.exports = { analyzeReport };
