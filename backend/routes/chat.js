const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { retrieve } = require("../utils/vectorStore");
const { complete } = require("../utils/aiClient");

const router = express.Router();

const CHAT_SYSTEM_PROMPT = `You are MedAssist AI's report assistant.
Answer the user's question using ONLY the report excerpts provided below as context.
Rules:
- Do NOT diagnose conditions or prescribe treatment.
- If the excerpts don't contain the answer, say so plainly instead of guessing.
- Explain medical terms in plain language.
- End with a brief reminder to confirm anything important with a healthcare professional, only if the question is clinical in nature.
- Keep answers concise (under 150 words) unless the question needs more detail.`;

// GET /api/chat/:reportId — conversation history for one report
router.get("/:reportId", requireAuth, (req, res) => {
  const report = db
    .prepare("SELECT id FROM reports WHERE id = ? AND user_id = ?")
    .get(req.params.reportId, req.user.id);
  if (!report) return res.status(404).json({ error: "Report not found." });

  const messages = db
    .prepare(
      "SELECT role, message, created_at FROM chat_messages WHERE report_id = ? AND user_id = ? ORDER BY id ASC"
    )
    .all(report.id, req.user.id);

  res.json({ messages });
});

// POST /api/chat/:reportId — ask a question, get a RAG-grounded answer
router.post("/:reportId", requireAuth, async (req, res) => {
  const { question } = req.body || {};
  if (!question || !question.trim()) {
    return res.status(400).json({ error: "Type a question first." });
  }

  const report = db
    .prepare("SELECT * FROM reports WHERE id = ? AND user_id = ?")
    .get(req.params.reportId, req.user.id);
  if (!report) return res.status(404).json({ error: "Report not found." });

  db.prepare(
    "INSERT INTO chat_messages (user_id, report_id, role, message) VALUES (?, ?, 'user', ?)"
  ).run(req.user.id, report.id, question.trim());

  // RAG step 1 — retrieval: embed the question, find the most similar chunks.
  const { chunks: topChunks, method } = await retrieve(report.id, question.trim(), 4);

  if (topChunks.length === 0) {
    const fallback =
      "I couldn't read any text from this report, so I have nothing to answer from. Go back to the report summary and press \"Retry analysis\" to see why, or upload a clearer copy.";
    db.prepare(
      "INSERT INTO chat_messages (user_id, report_id, role, message) VALUES (?, ?, 'assistant', ?)"
    ).run(req.user.id, report.id, fallback);
    return res.json({ answer: fallback, method: "none", sources: [] });
  }

  const context = topChunks.map((c, i) => `Excerpt ${i + 1}:\n${c.chunk_text}`).join("\n\n");

  let answer;
  try {
    answer = await complete({
      system: CHAT_SYSTEM_PROMPT,
      prompt: `Report excerpts:\n\n${context}\n\nQuestion: ${question.trim()}`,
      maxTokens: 1024,
    });
  } catch (err) {
    answer =
      "AI answers aren't available right now — check that GEMINI_API_KEY is set in backend/.env.";
  }

  db.prepare(
    "INSERT INTO chat_messages (user_id, report_id, role, message) VALUES (?, ?, 'assistant', ?)"
  ).run(req.user.id, report.id, answer);

  res.json({
    answer,
    method, // "embeddings" (semantic search) or "tfidf" (fallback)
    sources: topChunks.map((c) => ({
      chunk: c.chunk_index + 1,
      score: typeof c.score === "number" ? Number(c.score.toFixed(3)) : null,
    })),
  });
});

module.exports = router;
