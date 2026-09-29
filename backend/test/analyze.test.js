// End-to-end test of the upload pipeline with Gemini replaced by a stand-in.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "medassist-a-")), "t.db");
process.env.GEMINI_API_KEY = "fake";

const LAB = `Comprehensive Health Checkup
Blood Pressure 128/84 mmHg. Heart Rate 78 bpm. BMI 24.6
Total Cholesterol 215 mg/dL. LDL Cholesterol 142 mg/dL. HDL Cholesterol 38 mg/dL. Triglycerides 180 mg/dL.
Fasting Blood Glucose 112 mg/dL. Hemoglobin 13.1 g/dL. Creatinine 0.9 mg/dL.
Patient reports occasional chest discomfort on exertion.`;

let mode = { summaryError: null };
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  if (String(url).includes("batchEmbedContents")) {
    return { ok: true, status: 200, json: async () => ({ embeddings: body.requests.map(() => ({ values: [0.1, 0.2, 0.3] })) }) };
  }
  const isOcr = JSON.stringify(body).includes("inline_data");
  if (isOcr) {
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: LAB }] } }] }) };
  }
  if (mode.summaryError) {
    return { ok: false, status: 400, json: async () => ({ error: { message: mode.summaryError } }) };
  }
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Plain summary of your report." }] } }] }) };
};

const db = require("../db");
const { analyzeReport } = require("../utils/analyzeReport");
const UPLOADS = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

let seq = 0;
const created = [];
function makeUser() {
  return Number(db.prepare("INSERT INTO users (name,email,password_hash) VALUES ('u', ?, 'x')").run(`u${++seq}@t.com`).lastInsertRowid);
}
function makeReport(userId, mime, content) {
  const stored = `test-${Date.now()}-${++seq}`;
  fs.writeFileSync(path.join(UPLOADS, stored), content);
  created.push(stored);
  return Number(db.prepare("INSERT INTO reports (user_id, original_name, stored_name, mime_type, status) VALUES (?, 'r', ?, ?, 'processing')").run(userId, stored, mime).lastInsertRowid);
}
test.after(() => created.forEach((f) => fs.rmSync(path.join(UPLOADS, f), { force: true })));
const count = (sql, id) => db.prepare(sql).get(id).n;

test("text report: read, chunked, embedded, metrics, specialist and summary all produced", async () => {
  mode.summaryError = null;
  const u = makeUser();
  const id = makeReport(u, "text/plain", LAB);
  const r = await analyzeReport(id, u);
  assert.strictEqual(r.status, "ready");
  assert.strictEqual(r.extraction_method, "plain-text");
  assert.strictEqual(r.summary, "Plain summary of your report.");
  assert.strictEqual(r.error_message, null);
  assert.strictEqual(r.specialist, "Cardiologist");
  assert.ok(count("SELECT COUNT(*) n FROM report_chunks WHERE report_id=?", id) > 0);
  assert.strictEqual(count("SELECT COUNT(*) n FROM report_chunks WHERE report_id=? AND embedding IS NULL", id), 0);
  const names = db.prepare("SELECT metric_name FROM health_metrics WHERE report_id=?").all(id).map((m) => m.metric_name);
  ["Hemoglobin", "LDL Cholesterol", "Systolic BP", "Blood Glucose (Fasting)"].forEach((n) => assert.ok(names.includes(n), n));
});

test("scanned PDF: no text layer -> read by Gemini OCR -> full pipeline still works", async () => {
  mode.summaryError = null;
  const u = makeUser();
  const id = makeReport(u, "application/pdf", "%PDF-fake-scan");
  const r = await analyzeReport(id, u, { pdfParse: async () => ({ text: "" }) });
  assert.strictEqual(r.status, "ready");
  assert.strictEqual(r.extraction_method, "ocr");
  assert.ok(r.summary);
  assert.ok(count("SELECT COUNT(*) n FROM report_chunks WHERE report_id=?", id) > 0);
});

test("bad API key on the summary: report is still read; the REASON is saved and shown", async () => {
  mode.summaryError = "API key not valid. Please pass a valid API key.";
  const u = makeUser();
  const id = makeReport(u, "text/plain", LAB);
  const r = await analyzeReport(id, u);
  assert.strictEqual(r.status, "ready");
  assert.strictEqual(r.summary, null);
  assert.match(r.error_message, /AI summary failed/);
  assert.match(r.error_message, /API key not valid/);
  assert.ok(count("SELECT COUNT(*) n FROM report_chunks WHERE report_id=?", id) > 0);
  mode.summaryError = null;
});

test("Retry analysis: fixes it without duplicating chunks or metrics", async () => {
  mode.summaryError = "quota exceeded";
  const u = makeUser();
  const id = makeReport(u, "text/plain", LAB);
  await analyzeReport(id, u);
  const chunksBefore = count("SELECT COUNT(*) n FROM report_chunks WHERE report_id=?", id);
  const metricsBefore = count("SELECT COUNT(*) n FROM health_metrics WHERE report_id=?", id);

  mode.summaryError = null;
  const r = await analyzeReport(id, u);
  assert.strictEqual(r.summary, "Plain summary of your report.");
  assert.strictEqual(r.error_message, null);
  assert.strictEqual(count("SELECT COUNT(*) n FROM report_chunks WHERE report_id=?", id), chunksBefore);
  assert.strictEqual(count("SELECT COUNT(*) n FROM health_metrics WHERE report_id=?", id), metricsBefore);
});

test("no API key at all: text file still read; clear reason for the missing summary", async () => {
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const u = makeUser();
  const id = makeReport(u, "text/plain", LAB);
  const r = await analyzeReport(id, u);
  process.env.GEMINI_API_KEY = key;
  assert.strictEqual(r.status, "ready");
  assert.strictEqual(r.summary, null);
  assert.match(r.error_message, /GEMINI_API_KEY/);
  assert.ok(r.specialist);
});

test("image with no API key: explains why nothing was read", async () => {
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const u = makeUser();
  const id = makeReport(u, "image/png", "png");
  const r = await analyzeReport(id, u);
  process.env.GEMINI_API_KEY = key;
  assert.strictEqual(r.extraction_method, "none");
  assert.match(r.error_message, /image file/);
  assert.match(r.error_message, /GEMINI_API_KEY/);
});

test("a user cannot analyze someone else's report", async () => {
  const owner = makeUser();
  const other = makeUser();
  const id = makeReport(owner, "text/plain", LAB);
  assert.strictEqual(await analyzeReport(id, other), null);
});
