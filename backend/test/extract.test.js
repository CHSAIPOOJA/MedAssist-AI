const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { extractText } = require("../utils/pdfExtract");
const { ocrFile } = require("../utils/ocr");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "medassist-x-"));
const file = (name, content) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
};
const LAB = "Hemoglobin 13.1 g/dL. Total Cholesterol 215 mg/dL. LDL 142 mg/dL. Glucose 112 mg/dL.";

test("plain text file is read directly", async () => {
  const r = await extractText(file("a.txt", LAB), "text/plain");
  assert.strictEqual(r.method, "plain-text");
  assert.match(r.text, /Hemoglobin/);
});

test("empty text file gives a reason", async () => {
  const r = await extractText(file("e.txt", "  "), "text/plain");
  assert.strictEqual(r.method, "none");
  assert.match(r.reason, /empty/);
});

test("normal PDF: text layer used, OCR never called", async () => {
  process.env.GEMINI_API_KEY = "k";
  let ocrCalled = false;
  const r = await extractText(file("n.pdf", "%PDF"), "application/pdf", {
    pdfParse: async () => ({ text: LAB }),
    ocr: async () => { ocrCalled = true; return ""; },
  });
  assert.strictEqual(r.method, "pdf-text");
  assert.strictEqual(ocrCalled, false);
});

test("scanned PDF (no text layer) is read with Gemini OCR", async () => {
  process.env.GEMINI_API_KEY = "k";
  const r = await extractText(file("s.pdf", "%PDF"), "application/pdf", {
    pdfParse: async () => ({ text: "  3  " }), // just a page number
    ocr: async () => LAB,
  });
  assert.strictEqual(r.method, "ocr");
  assert.match(r.text, /Cholesterol/);
});

test("scanned PDF with no API key explains exactly what to do", async () => {
  delete process.env.GEMINI_API_KEY;
  const r = await extractText(file("s2.pdf", "%PDF"), "application/pdf", { pdfParse: async () => ({ text: "" }) });
  assert.strictEqual(r.method, "none");
  assert.strictEqual(r.text, null);
  assert.match(r.reason, /no selectable text/);
  assert.match(r.reason, /GEMINI_API_KEY/);
  assert.match(r.reason, /Retry analysis/);
});

test("OCR failure reason includes Gemini's own message", async () => {
  process.env.GEMINI_API_KEY = "k";
  const r = await extractText(file("s3.pdf", "%PDF"), "application/pdf", {
    pdfParse: async () => ({ text: "" }),
    ocr: async () => { throw new Error("API key not valid. Please pass a valid API key."); },
  });
  assert.strictEqual(r.method, "none");
  assert.match(r.reason, /API key not valid/);
});

test("damaged PDF (parser throws) falls through to OCR instead of crashing", async () => {
  process.env.GEMINI_API_KEY = "k";
  const r = await extractText(file("bad.pdf", "junk"), "application/pdf", {
    pdfParse: async () => { throw new Error("Invalid PDF structure"); },
    ocr: async () => LAB,
  });
  assert.strictEqual(r.method, "ocr");
});

test("OCR finds nothing readable -> clear reason", async () => {
  process.env.GEMINI_API_KEY = "k";
  const r = await extractText(file("blank.png", "png"), "image/png", { ocr: async () => "" });
  assert.strictEqual(r.method, "none");
  assert.match(r.reason, /could not find readable text/);
});

test("ocrFile sends the file as inline_data to generateContent with the key header", async () => {
  process.env.GEMINI_API_KEY = "secret";
  const p = file("photo.png", Buffer.from("PNGDATA"));
  let seen;
  global.fetch = async (url, opts) => {
    seen = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Hb 13" }] } }] }) };
  };
  const text = await ocrFile(p, "image/png");
  assert.strictEqual(text, "Hb 13");
  assert.match(seen.url, /:generateContent$/);
  assert.strictEqual(seen.opts.headers["x-goog-api-key"], "secret");
  const part = seen.body.contents[0].parts[0].inline_data;
  assert.strictEqual(part.mime_type, "image/png");
  assert.strictEqual(part.data, Buffer.from("PNGDATA").toString("base64"));
});
