// An existing database created BEFORE embeddings existed must upgrade cleanly
// (this is exactly the situation on your machine).
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

test("old DB without the embedding column is migrated and keeps its data", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "medassist-old-")), "old.db");
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password_hash TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, original_name TEXT, stored_name TEXT, mime_type TEXT, extracted_text TEXT, summary TEXT, specialist TEXT, specialist_reason TEXT, status TEXT DEFAULT 'processing', error_message TEXT, uploaded_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE report_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER, chunk_index INTEGER, chunk_text TEXT);
    INSERT INTO report_chunks (report_id, chunk_index, chunk_text) VALUES (1, 0, 'old chunk kept');
  `);
  old.close();

  process.env.DB_PATH = file;
  const db = require("../db");
  const cols = db.prepare("PRAGMA table_info(report_chunks)").all().map((c) => c.name);
  assert.ok(cols.includes("embedding"), "embedding column added");
  const row = db.prepare("SELECT chunk_text, embedding FROM report_chunks").get();
  assert.strictEqual(row.chunk_text, "old chunk kept");
  assert.strictEqual(row.embedding, null);
});
