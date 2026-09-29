// rag.js — a small, dependency-free retrieval layer.
//
// Real-world RAG systems use a vector database with embeddings. For this
// project's scale (a handful of reports per user, each a few pages), a
// TF-IDF style bag-of-words ranking gives good-enough retrieval without
// needing an embeddings service or a vector DB to install and run.

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","of","to","in","on","for","and","or",
  "with","this","that","it","as","by","be","at","from","your","you","i","my",
  "me","what","does","do","did","has","have","had","can","could","should",
  "would","will","about","any","if","so","but","not","no","which","who","how"
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9%./\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Splits text into overlapping chunks so a fact near a chunk boundary is
 * never entirely lost to one side.
 */
function chunkText(text, chunkSize = 700, overlap = 120) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    chunks.push(clean.slice(start, end).trim());
    if (end === clean.length) break;
    start = end - overlap;
  }
  return chunks.filter(Boolean);
}

/**
 * Ranks chunks against a query using term-frequency overlap weighted by how
 * rare each term is across the chunk set (a simplified TF-IDF), and returns
 * the top `k` chunks in original order.
 */
function rankChunks(chunks, query, k = 4) {
  if (chunks.length === 0) return [];

  const docs = chunks.map((c) => tokenize(c.chunk_text || c));
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return chunks.slice(0, k);

  const docFreq = {};
  docs.forEach((doc) => {
    new Set(doc).forEach((term) => {
      docFreq[term] = (docFreq[term] || 0) + 1;
    });
  });

  const N = docs.length;
  const scores = docs.map((doc, idx) => {
    const termCounts = {};
    doc.forEach((t) => (termCounts[t] = (termCounts[t] || 0) + 1));

    let score = 0;
    queryTerms.forEach((qt) => {
      const tf = termCounts[qt] || 0;
      if (tf === 0) return;
      const idf = Math.log(1 + N / (1 + (docFreq[qt] || 0)));
      score += tf * idf;
    });

    return { idx, score };
  });

  scores.sort((a, b) => b.score - a.score);

  const top = scores.filter((s) => s.score > 0).slice(0, k);
  const chosen = top.length > 0 ? top : scores.slice(0, k);

  return chosen
    .sort((a, b) => a.idx - b.idx) // restore reading order
    .map((s) => chunks[s.idx]);
}

// ---------------------------------------------------------------------
// Embedding-based retrieval (semantic search)
// ---------------------------------------------------------------------

/** Cosine similarity: 1 = same direction (same meaning), 0 = unrelated. */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Vector <-> compact binary (Float32) so it fits in a SQLite BLOB. */
function vectorToBlob(vec) {
  return new Uint8Array(new Float32Array(vec).buffer);
}
function blobToVector(blob) {
  if (!blob) return null;
  const copy = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return Array.from(new Float32Array(copy));
}

/**
 * Ranks chunks by cosine similarity to the query vector and returns the
 * top `k`, put back into reading order. Each chunk must have `.vector`.
 * Every returned chunk also carries its similarity `.score`.
 */
function rankByEmbedding(chunks, queryVector, k = 4) {
  const scored = chunks
    .filter((c) => c.vector)
    .map((c) => ({ ...c, score: cosineSimilarity(c.vector, queryVector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).sort((a, b) => a.chunk_index - b.chunk_index);
}

module.exports = {
  chunkText, rankChunks, tokenize,
  cosineSimilarity, vectorToBlob, blobToVector, rankByEmbedding,
};
