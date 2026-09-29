// db.js — SQLite database connection and schema.
// Uses node:sqlite, Node's built-in SQLite module (stable since Node 22.5+ /
// unflagged from Node 23.4+): synchronous, file-based, and needs no native
// compilation — nothing to install, unlike better-sqlite3.

const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "medassist.db");
const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  extracted_text TEXT,
  summary TEXT,
  specialist TEXT,
  specialist_reason TEXT,
  status TEXT NOT NULL DEFAULT 'processing', -- processing | ready | failed
  error_message TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  unit TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT,
  time_of_day TEXT,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'user' | 'assistant'
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_report ON report_chunks(report_id);
CREATE INDEX IF NOT EXISTS idx_metrics_user ON health_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_medicines_user ON medicines(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id);
`);

// ---- migration: vector column for embedding-based RAG ----
// Existing databases were created before embeddings existed, so add the
// column if it's missing. Old rows simply have NULL until they're indexed
// (this happens automatically the first time you chat with that report).
const chunkCols = db.prepare("PRAGMA table_info(report_chunks)").all();
if (!chunkCols.some((c) => c.name === "embedding")) {
  db.exec("ALTER TABLE report_chunks ADD COLUMN embedding BLOB");
}

// how the report's text was obtained: plain-text | pdf-text | ocr | none
const reportCols = db.prepare("PRAGMA table_info(reports)").all();
if (!reportCols.some((c) => c.name === "extraction_method")) {
  db.exec("ALTER TABLE reports ADD COLUMN extraction_method TEXT");
}

// remembers which reminder emails were already sent, so none is ever sent twice
db.exec(`
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  due_time TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (medicine_id, due_date, due_time)
);
`);

module.exports = db;
