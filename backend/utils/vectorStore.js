// vectorStore.js — the "vector database" part of RAG.
//
// Chunk embeddings are stored in SQLite (report_chunks.embedding) and
// searched with cosine similarity in JavaScript. For a personal report
// archive (tens to hundreds of chunks per user) this is fast and means no
// separate vector-database server to install, run, or pay for.

const db = require("../db");
const { embedTexts } = require("./aiClient");
const { rankChunks, rankByEmbedding, vectorToBlob, blobToVector } = require("./rag");

function loadChunks(reportId) {
  return db
    .prepare(
      `SELECT id, chunk_index, chunk_text, embedding
       FROM report_chunks WHERE report_id = ? ORDER BY chunk_index ASC`
    )
    .all(reportId);
}

/**
 * Embeds every chunk of a report that doesn't have a vector yet and stores
 * it. Safe to call repeatedly — it only does work for un-indexed chunks,
 * which is also how reports uploaded before this feature existed get
 * upgraded automatically.
 */
async function indexReport(reportId) {
  const pending = db
    .prepare(
      `SELECT id, chunk_text FROM report_chunks
       WHERE report_id = ? AND embedding IS NULL ORDER BY chunk_index ASC`
    )
    .all(reportId);
  if (pending.length === 0) return 0;

  const vectors = await embedTexts(pending.map((c) => c.chunk_text), "RETRIEVAL_DOCUMENT");
  const update = db.prepare("UPDATE report_chunks SET embedding = ? WHERE id = ?");
  pending.forEach((c, i) => update.run(vectorToBlob(vectors[i]), c.id));
  return pending.length;
}

/**
 * Finds the chunks of a report most relevant to a question.
 *   1. embed the question           (RETRIEVAL_QUERY)
 *   2. compare with stored chunk vectors (cosine similarity)
 *   3. return the top-k chunks
 * If embeddings aren't available (no API key, quota hit, network error) it
 * falls back to TF-IDF keyword ranking so chat keeps working.
 *
 * Returns { chunks, method } where method is "embeddings" | "tfidf" | "none".
 */
async function retrieve(reportId, question, k = 4) {
  let chunks = loadChunks(reportId);
  if (chunks.length === 0) return { chunks: [], method: "none" };

  if (process.env.GEMINI_API_KEY) {
    try {
      if (chunks.some((c) => !c.embedding)) {
        await indexReport(reportId);
        chunks = loadChunks(reportId);
      }
      const [queryVector] = await embedTexts([question], "RETRIEVAL_QUERY");
      const withVectors = chunks.map((c) => ({ ...c, vector: blobToVector(c.embedding) }));
      const top = rankByEmbedding(withVectors, queryVector, k);
      if (top.length > 0) return { chunks: top, method: "embeddings" };
    } catch (err) {
      console.warn("Embedding retrieval failed, falling back to TF-IDF:", err.message);
    }
  }

  return { chunks: rankChunks(chunks, question, k), method: "tfidf" };
}

module.exports = { indexReport, retrieve, loadChunks };
