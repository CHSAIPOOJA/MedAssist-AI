const fs = require("fs");
const { ocrFile } = require("./ocr");

// A page number or footer isn't a report. Require a real amount of text.
const MIN_CHARS = 40;
const hasEnoughText = (t) => (t || "").replace(/\s/g, "").length >= MIN_CHARS;

async function viaOcr(filePath, mimeType, why, deps) {
  if (!process.env.GEMINI_API_KEY) {
    return {
      text: null,
      method: "none",
      reason: `${why}, and no GEMINI_API_KEY is set to read it with AI. Add a key (run "npm run setup") and press Retry analysis.`,
    };
  }
  try {
    const text = await (deps.ocr || ocrFile)(filePath, mimeType);
    if (hasEnoughText(text)) return { text, method: "ocr" };
    return {
      text: null,
      method: "none",
      reason: `${why}, and Gemini could not find readable text in it. Try a clearer copy.`,
    };
  } catch (err) {
    return {
      text: null,
      method: "none",
      reason: `${why}, and reading it with Gemini failed: ${err.message}`,
    };
  }
}

/**
 * Gets readable text out of an uploaded report.
 * Returns { text, method, reason } where method is:
 *   "plain-text" | "pdf-text" (normal PDF) | "ocr" (scan/photo read by Gemini) | "none"
 * When method is "none", `reason` explains why in plain English.
 */
async function extractText(filePath, mimeType, deps = {}) {
  if (mimeType === "text/plain") {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (hasEnoughText(text)) return { text, method: "plain-text" };
    return { text: null, method: "none", reason: "The text file is empty or nearly empty." };
  }

  if (mimeType === "application/pdf") {
    let text = "";
    try {
      const pdfParse = deps.pdfParse || require("pdf-parse");
      text = ((await pdfParse(fs.readFileSync(filePath))).text || "").trim();
    } catch (err) {
      text = ""; // damaged/unusual PDF — try reading it with AI instead
    }
    if (hasEnoughText(text)) return { text, method: "pdf-text" };
    return viaOcr(filePath, mimeType, "This PDF has no selectable text (it looks like a scan)", deps);
  }

  // PNG / JPG photos of a report
  return viaOcr(filePath, mimeType, "This is an image file", deps);
}

module.exports = { extractText, hasEnoughText };
