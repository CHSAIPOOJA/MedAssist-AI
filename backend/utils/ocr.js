// ocr.js — reads text out of scanned PDFs and photos using Gemini's vision.
// Gemini accepts a PDF or image directly and can transcribe it, so no extra
// OCR software or packages are needed — it reuses your GEMINI_API_KEY.

const fs = require("fs");

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BYTES = 14 * 1024 * 1024; // inline upload limit is ~20 MB after base64

const PROMPT =
  "Transcribe ALL the text in this medical report exactly as written. " +
  "Keep tables as one line per row (test name, value, unit, reference range). " +
  "Do not summarise, explain, or add commentary. Output only the transcribed text.";

async function ocrFile(filePath, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const buffer = fs.readFileSync(filePath);
  if (buffer.length > MAX_BYTES) {
    throw new Error("the file is too large to read with AI (limit is about 14 MB)");
  }

  const model = process.env.OCR_MODEL || process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const response = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini API error (${response.status})`);
  }
  const candidate = data?.candidates?.[0];
  return (candidate?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

module.exports = { ocrFile };
