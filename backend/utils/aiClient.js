// aiClient.js — thin wrapper around Google's Gemini API so the rest of the
// app calls one simple function instead of touching the REST API directly.
//
// Uses Gemini because it has a genuinely free tier (a free key from
// https://aistudio.google.com/apikey, no credit card required for the
// free-tier models). Calls the REST endpoint with Node's built-in fetch,
// so there's no extra SDK package that could fail to install.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Sends a single-turn prompt with a system instruction and returns plain text.
 * Throws a friendly error if no API key is configured, so routes can catch
 * it and degrade gracefully instead of crashing.
 */
async function complete({ system, prompt, maxTokens = 800 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set in backend/.env — AI summaries and chat need it to work."
    );
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || `Gemini API error (${response.status})`;
    throw new Error(message);
  }

  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("").trim();

  if (!text) {
    // Most common cause: the response was cut off by a safety filter.
    const reason = candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : "";
    throw new Error(`Gemini returned an empty response${reason}.`);
  }

  return text;
}

/**
 * Turns texts into embedding vectors (arrays of numbers) using Gemini's
 * embedding model. Texts with similar MEANING get vectors that point in
 * similar directions, which is what lets us search by meaning instead of
 * by exact words.
 *
 * taskType matters: use "RETRIEVAL_DOCUMENT" for report chunks and
 * "RETRIEVAL_QUERY" for the user's question — the model embeds each
 * differently so questions land close to the passages that answer them.
 */
async function embedTexts(texts, taskType = "RETRIEVAL_DOCUMENT") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in backend/.env — embeddings need it.");
  }
  if (!texts.length) return [];

  const model = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
  const dims = parseInt(process.env.EMBEDDING_DIMS || "768", 10);
  const BATCH = 50; // stay well under the API's per-request limit
  const vectors = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const response = await fetch(`${GEMINI_BASE}/${model}:batchEmbedContents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: dims,
        })),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `Embedding API error (${response.status})`);
    }
    const got = (data.embeddings || []).map((e) => e.values);
    if (got.length !== batch.length || got.some((v) => !Array.isArray(v) || v.length === 0)) {
      throw new Error("Embedding API returned an unexpected response.");
    }
    vectors.push(...got);
  }
  return vectors;
}

module.exports = { complete, embedTexts };
