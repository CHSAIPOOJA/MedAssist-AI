# MedAssist AI

<<<<<<< HEAD
A personalized healthcare assistant that simplifies medical report interpretation
and helps manage health information — built for the Engineering Capstone Project
(Dept. of CSE, 23IE4053R/23IE4053A).

This is a full stack implementation of every feature in the project abstract:

| Feature (from the abstract)              | Where it lives |
|---|---|
| Secure report upload & storage           | `backend/routes/reports.js`, `uploads/`, SQLite `reports` table |
| AI plain-language summaries              | `backend/utils/aiClient.js` + `reports.js` (Claude API) |
| RAG-based chatbot on uploaded reports     | `backend/routes/chat.js` + `backend/utils/rag.js` + `backend/utils/vectorStore.js` |
| Personal health history & trend graphs   | `backend/routes/dashboard.js`, `health_metrics` table, Chart.js on the frontend |
| Medicine reminders (+ email alerts)       | `backend/routes/reminders.js`, `backend/utils/reminderScheduler.js`, `backend/utils/mailer.js` |
| Specialist recommendation                 | `backend/utils/specialistRules.js`, `backend/routes/specialist.js` |

## Quick start (Windows)

1. Unzip, then **double-click `start.bat`**.
2. First run: it installs packages (about a minute), then asks you to paste your **free Gemini API key** from https://aistudio.google.com/apikey (or press Enter to skip AI), and optionally your Gmail address + an App Password to turn on **medicine reminder emails**.
3. Your browser opens at http://localhost:4000. Create an account and go.

Next time, just double-click `start.bat` again. To change the key later, run `npm run setup` inside `backend/`.
Requires Node.js 22.5 or newer (https://nodejs.org).

The manual steps below do the same thing by hand.

## Stack

- **Frontend:** plain HTML/CSS/JS (no build step) — `frontend/`
- **Backend:** Node.js + Express — `backend/`
- **Database:** SQLite via Node's built-in `node:sqlite` module — a single file, `backend/medassist.db`, created automatically on first run. No native compilation and nothing extra to install, unlike `better-sqlite3`.
- **AI:** Google's Gemini API (free tier) for summaries and the report chatbot

## 1. Install

You need [Node.js](https://nodejs.org) **22.5 or newer** installed (`node:sqlite` isn't available before that). Check with `node -v`.

```bash
cd backend
npm install
```

## 2. Configure

```bash
cp .env.example .env
```

Open `backend/.env` and set:

- `JWT_SECRET` — any long random string (used to sign login tokens)
- `GEMINI_API_KEY` — a **free** key from https://aistudio.google.com/apikey (sign in with any Google account, click "Create API key" — no credit card needed). Needed for AI summaries and the chatbot — everything else works without it.

## 3. Run

```bash
npm start
```

Then open **http://localhost:4000** in your browser. Create an account, and you're in.

Use `npm run dev` instead of `npm start` while developing — it restarts the server automatically when you edit a file.

## How the AI features work

- **Report summaries:** when a PDF or text report is uploaded, its text is extracted (`pdf-parse`), sent to Gemini with instructions to explain it in plain language without diagnosing, and the summary is stored alongside the report.
- **RAG chatbot (embedding-based semantic search):**
  1. On upload, the report text is split into overlapping chunks (`rag.js`).
  2. Each chunk is converted into an **embedding** (a 768-number vector capturing its meaning) with Gemini's `gemini-embedding-001` and stored in SQLite (`report_chunks.embedding`) — this is the vector store (`vectorStore.js`).
  3. When you ask a question, the question is embedded too, then compared with every chunk vector using **cosine similarity**; the most similar chunks are retrieved.
  4. Those chunks + the question are sent to Gemini, which answers using only that context. The UI shows which excerpts were used and how they were retrieved.
  - If embeddings are unavailable (no key, quota, network), retrieval automatically falls back to **TF-IDF keyword ranking**, so chat never breaks.
  - Reports uploaded before this feature existed are indexed automatically the first time you ask about them.
  - The vectors live inside SQLite and are searched in JavaScript — no separate vector-database server is needed at this scale.
- **Health trends:** a small pattern-matching pass (`backend/utils/metrics.js`) looks for common lab values (hemoglobin, glucose, cholesterol, blood pressure, etc.) in the extracted text and stores them as data points, which the dashboard charts over time as you upload more reports.
- **Specialist recommendation:** a transparent keyword rule engine (`backend/utils/specialistRules.js`) — not a black box — matches terms in the report or in symptoms you describe to a specialist type.

**Scanned reports and photos:** if a PDF has no selectable text (a scan) or you upload a PNG/JPG, the text is read by Gemini's vision (`utils/ocr.js`) using the same API key, then goes through the normal pipeline. If a report can't be read, or the AI summary fails, the report page shows the exact reason and a **Retry analysis** button. Note that scans/photos are sent to Google's Gemini service to be read.

## Project structure

```
medassist-ai/
├── backend/
│   ├── server.js          entry point
│   ├── db.js               SQLite connection + schema
│   ├── middleware/auth.js  JWT auth guard
│   ├── routes/              auth, reports, chat, dashboard, reminders, specialist
│   ├── utils/                pdf extraction, RAG, metrics, specialist rules, AI client
│   └── uploads/              uploaded report files (git-ignored)
└── frontend/
    ├── index.html          sign in / create account
    ├── app.html             the app: overview, reports, medicines, specialist finder
    ├── css/style.css
    └── js/                    api.js, auth.js, app.js
```

## Notes for the capstone writeup

- Passwords are hashed with bcrypt; sessions use signed JWTs.
- The RAG pipeline uses real embeddings + cosine similarity, with vectors stored in SQLite (no separate vector-DB server), and a TF-IDF fallback for resilience.
- The app is explicit everywhere that it explains and organizes information — it does not diagnose, and repeatedly nudges the user toward a qualified healthcare professional, matching the scope described in the abstract.

## Medicine reminder emails (optional)

MedAssist can email you when it's time to take a medicine. It uses your own Gmail account through SMTP — no third-party notification service, and no cost.

**Turn it on:**
```bash
cd backend
npm run setup:email
```
You'll need a Gmail account with **2-Step Verification** turned on, and an **App Password** from https://myaccount.google.com/apppasswords (a 16-letter code — never use your real Gmail password here). The setup script checks the login with Gmail before saving it.

**How it works:** while the server is running, it checks every 30 seconds for any medicine whose "time of day" has just arrived (`backend/utils/timeParser.js` understands things like `8am and 8pm`, `8:00 AM, 8:00 PM`, or `morning and night`). Each medicine is emailed once per day at each of its times — never twice, even if the server restarts, because sent reminders are logged in the `reminder_log` table. Medicines due for the same person at the same time are combined into a single email.

**Limits worth knowing:**
- Reminders only fire while the app is running on your machine — there's no reminder if your computer is off or the app is closed.
- It's tied to your computer's local clock and timezone.
- Gmail's own sending limit is about 500 emails/day on a personal account — far more than a reminder app needs.

Check anytime from the **Medicines** tab, which shows whether email is on and has a **Send test email** button.

## Tests

```bash
cd backend
npm test
```

Runs 9 tests covering cosine similarity, vector storage, indexing, semantic retrieval, lazy indexing of old reports, TF-IDF fallback, and the database migration. (Embedding calls are simulated in tests, so no API key is needed to run them.)
=======
A basic local application for uploading a medical report PDF and extracting its text.

## Backend

From the project root, activate the existing virtual environment (or create one), then install the dependencies:

```powershell
cd backend
python -m pip install -r requirements.txt
uvicorn main:app --reload
```

For scanned or image-only PDFs, install the Tesseract OCR application on Windows and ensure `tesseract.exe` is on your PATH. Regular text PDFs work with PyMuPDF alone.

The API runs at `http://localhost:8000`.

## Frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Use any non-empty email/username and password to enter the dashboard. Select a PDF and choose **Upload & Extract** to view its extracted text.

This initial version uses local dummy login state only. It does not include RAG, an LLM, database storage, diagnosis, or predictions.
>>>>>>> b38b0f528c08ac42ccb66c5d80dd6214828eb516
