// Tests for the embedding-based RAG pipeline.
// The Gemini embedding endpoint is replaced with a small deterministic fake
// (a concept-based vector) so we can verify chunking -> storing vectors ->
// similarity search -> ranking -> fallback, without a network or API key.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "medassist-")), "test.db");
process.env.GEMINI_API_KEY = "fake-key";

// fake embedding: 4 "concept" dimensions -> lipids, sugar, kidney, vitamin
const CONCEPTS = [
  ["cholesterol", "ldl", "hdl", "triglyceride", "lipid"],
  ["glucose", "sugar", "diabetes", "insulin"],
  ["creatinine", "kidney", "renal"],
  ["vitamin", "supplement", "deficiency"],
];
const fakeVector = (text) => {
  const t = text.toLowerCase();
  return CONCEPTS.map((words) => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0) + 0.01);
};
let embedCalls = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  embedCalls.push({ url, taskTypes: body.requests.map((r) => r.taskType) });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      embeddings: body.requests.map((r) => ({ values: fakeVector(r.content.parts[0].text) })),
    }),
  };
};

const db = require("../db");
const rag = require("../utils/rag");
const { indexReport, retrieve } = require("../utils/vectorStore");

let seq = 0;
function seedReport(chunks) {
  const u = db.prepare("INSERT INTO users (name,email,password_hash) VALUES ('t', ?, 'x')").run(`t${++seq}@t.com`);
  const r = db
    .prepare("INSERT INTO reports (user_id, original_name, stored_name, mime_type, status) VALUES (?, 'r.pdf','r.pdf','application/pdf','ready')")
    .run(u.lastInsertRowid);
  const ins = db.prepare("INSERT INTO report_chunks (report_id, chunk_index, chunk_text) VALUES (?,?,?)");
  chunks.forEach((c, i) => ins.run(r.lastInsertRowid, i, c));
  return Number(r.lastInsertRowid);
}

test("cosine similarity: identical=1, orthogonal=0, mismatched/empty=0", () => {
  assert.ok(Math.abs(rag.cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  assert.strictEqual(rag.cosineSimilarity([1, 0], [0, 1]), 0);
  assert.strictEqual(rag.cosineSimilarity([1, 2], [1, 2, 3]), 0);
  assert.strictEqual(rag.cosineSimilarity([], []), 0);
});

test("vector <-> BLOB round trip survives SQLite storage", () => {
  const v = [0.5, -1.25, 3.75, 0.001];
  db.exec("CREATE TABLE IF NOT EXISTS t (b BLOB)");
  db.prepare("INSERT INTO t VALUES (?)").run(rag.vectorToBlob(v));
  const back = rag.blobToVector(db.prepare("SELECT b FROM t").get().b);
  v.forEach((x, i) => assert.ok(Math.abs(back[i] - x) < 1e-6));
});

test("indexReport stores a vector for every chunk, only once", async () => {
  const id = seedReport([
    "Total Cholesterol 215 mg/dL, LDL 142 mg/dL, HDL 38, triglycerides 180.",
    "Fasting glucose 112 mg/dL. Sugar slightly raised, watch for diabetes.",
    "Creatinine 0.9 mg/dL, kidney function normal.",
    "Vitamin D 22 ng/mL indicates deficiency; supplement advised.",
  ]);
  embedCalls = [];
  assert.strictEqual(await indexReport(id), 4);
  assert.strictEqual(embedCalls.length, 1, "one batched API call");
  assert.ok(embedCalls[0].taskTypes.every((t) => t === "RETRIEVAL_DOCUMENT"));
  assert.strictEqual(await indexReport(id), 0, "second run does nothing");
  const stored = db.prepare("SELECT COUNT(*) n FROM report_chunks WHERE report_id=? AND embedding IS NOT NULL").get(id).n;
  assert.strictEqual(stored, 4);
});

test("retrieve() finds the right chunk by meaning, using a QUERY embedding", async () => {
  const id = seedReport([
    "Total Cholesterol 215 mg/dL, LDL 142 mg/dL, HDL 38, triglycerides 180.",
    "Fasting glucose 112 mg/dL. Sugar slightly raised, watch for diabetes.",
    "Creatinine 0.9 mg/dL, kidney function normal.",
    "Vitamin D 22 ng/mL indicates deficiency; supplement advised.",
  ]);
  embedCalls = [];
  const { chunks, method } = await retrieve(id, "Is my LDL a problem?", 1);
  assert.strictEqual(method, "embeddings");
  assert.strictEqual(chunks.length, 1);
  assert.match(chunks[0].chunk_text, /Cholesterol/);
  assert.ok(typeof chunks[0].score === "number" && chunks[0].score > 0.9);
  const queryCall = embedCalls[embedCalls.length - 1];
  assert.deepStrictEqual(queryCall.taskTypes, ["RETRIEVAL_QUERY"]);

  const kidney = await retrieve(id, "how are my kidneys", 1);
  assert.match(kidney.chunks[0].chunk_text, /Creatinine/);
});

test("old reports (no vectors yet) are indexed lazily on first question", async () => {
  const id = seedReport(["Vitamin D low, supplement advised.", "Glucose 112 sugar high."]);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_chunks WHERE report_id=? AND embedding IS NOT NULL").get(id).n, 0);
  const { method, chunks } = await retrieve(id, "sugar level?", 1);
  assert.strictEqual(method, "embeddings");
  assert.match(chunks[0].chunk_text, /Glucose/);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_chunks WHERE report_id=? AND embedding IS NOT NULL").get(id).n, 2);
});

test("falls back to TF-IDF when embeddings fail (quota/network)", async () => {
  const id = seedReport(["Creatinine 0.9 kidney normal.", "Glucose 112 raised sugar."]);
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) });
  const { method, chunks } = await retrieve(id, "kidney creatinine", 1);
  global.fetch = realFetch;
  assert.strictEqual(method, "tfidf");
  assert.match(chunks[0].chunk_text, /Creatinine/);
});

test("falls back to TF-IDF when there is no API key", async () => {
  const id = seedReport(["Creatinine 0.9 kidney normal.", "Glucose 112 raised sugar."]);
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const { method } = await retrieve(id, "glucose", 1);
  process.env.GEMINI_API_KEY = key;
  assert.strictEqual(method, "tfidf");
});

test("report with no chunks returns method 'none'", async () => {
  const u = db.prepare("INSERT INTO users (name,email,password_hash) VALUES ('t2', ?, 'x')").run(`t${++seq}@t.com`);
  const r = db.prepare("INSERT INTO reports (user_id, original_name, stored_name, mime_type, status) VALUES (?, 'i.png','i.png','image/png','ready')").run(u.lastInsertRowid);
  const out = await retrieve(Number(r.lastInsertRowid), "anything", 4);
  assert.deepStrictEqual(out, { chunks: [], method: "none" });
});
