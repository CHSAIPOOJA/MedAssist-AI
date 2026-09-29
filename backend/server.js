const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const reportsRoutes = require("./routes/reports");
const chatRoutes = require("./routes/chat");
const dashboardRoutes = require("./routes/dashboard");
const remindersRoutes = require("./routes/reminders");
const specialistRoutes = require("./routes/specialist");
const reminderScheduler = require("./utils/reminderScheduler");
const mailer = require("./utils/mailer");

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is not set. Run \"npm run setup\" in the backend folder (or double-click start.bat) to create backend/.env.");
  process.exit(1);
}

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reminders", remindersRoutes);
app.use("/api/specialist", specialistRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY), emailConfigured: mailer.isConfigured() });
});

// Serve the frontend and uploaded report files.
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// JSON error handler (e.g. Multer file-type/size errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MedAssist AI backend running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY is not set — summaries and chat will be disabled until you add one.");
  }
  if (mailer.isConfigured()) {
    console.log(`Email reminders: ON (sending from ${process.env.SMTP_USER})`);
  } else {
    console.log('Email reminders: OFF - run "npm run setup:email" to turn them on.');
  }
  reminderScheduler.start();
});
