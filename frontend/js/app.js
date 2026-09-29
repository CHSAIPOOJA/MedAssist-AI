// app.js — behavior for app.html: tab switching plus each feature panel.

if (!getToken()) {
  window.location.href = "index.html";
}

const user = getUser();
document.getElementById("whoName").textContent = user ? user.name : "";
document.getElementById("logoutBtn").addEventListener("click", () => {
  clearSession();
  window.location.href = "index.html";
});

const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- tabs ----------
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

function activatePanel(panelId) {
  panels.forEach((p) => p.classList.toggle("active", p.id === panelId));
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.panel === panelId));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activatePanel(tab.dataset.panel);
    if (tab.dataset.panel === "panel-dashboard") loadDashboard();
    if (tab.dataset.panel === "panel-reports") loadReports();
    if (tab.dataset.panel === "panel-reminders") loadReminders();
  });
});

document.getElementById("backToReports").addEventListener("click", () => {
  activatePanel("panel-reports");
});

// =====================================================================
// Dashboard
// =====================================================================
const chartInstances = [];

async function loadDashboard() {
  try {
    const data = await api("/dashboard");
    if (!data) return;

    document.getElementById("statReports").textContent = data.reportCount;
    document.getElementById("statMedicines").textContent = data.activeMedicineCount;
    document.getElementById("statLast").textContent = data.lastReport
      ? new Date(data.lastReport.uploaded_at).toLocaleDateString()
      : "—";

    renderCharts(data.metricSeries);
  } catch (err) {
    console.error(err);
  }
}

function renderCharts(metricSeries) {
  const grid = document.getElementById("chartGrid");
  chartInstances.forEach((c) => c.destroy());
  chartInstances.length = 0;
  grid.innerHTML = "";

  const names = Object.keys(metricSeries || {});
  if (names.length === 0) {
    grid.innerHTML =
      '<div class="empty-note">Upload a report with lab values (like hemoglobin or cholesterol) to see trends here.</div>';
    return;
  }

  names.forEach((name) => {
    const series = metricSeries[name];
    const card = document.createElement("div");
    card.className = "chart-card";
    card.innerHTML = `<h3>${name}${series.unit ? ` (${series.unit})` : ""}</h3><canvas></canvas>`;
    grid.appendChild(card);

    const ctx = card.querySelector("canvas").getContext("2d");
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: series.points.map((p) => new Date(p.date).toLocaleDateString()),
        datasets: [
          {
            label: name,
            data: series.points.map((p) => p.value),
            borderColor: "#276655",
            backgroundColor: "#DCEAE3",
            tension: 0.25,
            fill: true,
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: false } },
      },
    });
    chartInstances.push(chart);
  });
}

// =====================================================================
// Reports
// =====================================================================
let currentReportId = null;

async function loadReports() {
  const errBox = document.getElementById("reportsError");
  errBox.classList.remove("show");
  try {
    const data = await api("/reports");
    if (!data) return;
    renderReportList(data.reports);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.add("show");
  }
}

function renderReportList(reports) {
  const list = document.getElementById("reportList");
  list.innerHTML = "";

  if (reports.length === 0) {
    list.innerHTML = '<div class="empty-note">No reports uploaded yet.</div>';
    return;
  }

  reports.forEach((r) => {
    const item = document.createElement("div");
    item.className = "report-item";
    item.innerHTML = `
      <div>
        <div>${r.original_name}</div>
        <div class="meta">${new Date(r.uploaded_at).toLocaleString()}${r.specialist ? " · " + r.specialist : ""}</div>
      </div>
      <span class="status-pill ${r.status}">${r.status}</span>
    `;
    item.addEventListener("click", () => openReport(r.id));
    list.appendChild(item);
  });
}

document.getElementById("uploadBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("reportFile");
  const statusEl = document.getElementById("uploadStatus");
  const errBox = document.getElementById("reportsError");
  errBox.classList.remove("show");

  if (!fileInput.files[0]) {
    errBox.textContent = "Choose a file first.";
    errBox.classList.add("show");
    return;
  }

  const formData = new FormData();
  formData.append("report", fileInput.files[0]);

  statusEl.innerHTML = '<span class="spinner"></span> Uploading and analyzing…';
  try {
    const data = await api("/reports", { method: "POST", body: formData, isForm: true });
    statusEl.textContent = "Done.";
    fileInput.value = "";
    await loadReports();
    if (data && data.report) openReport(data.report.id);
  } catch (err) {
    statusEl.textContent = "";
    errBox.textContent = err.message;
    errBox.classList.add("show");
  }
});

async function openReport(id) {
  currentReportId = id;
  activatePanel("panel-detail");

  document.getElementById("detailSummary").innerHTML = "Loading…";
  document.getElementById("detailStatusNote").textContent = "";
  document.getElementById("detailSpecialistBox").style.display = "none";
  document.getElementById("chatLog").innerHTML = "";

  try {
    const data = await api(`/reports/${id}`);
    if (!data) return;
    const r = data.report;

    const noteEl = document.getElementById("detailStatusNote");
    const retryBtn = document.getElementById("retryBtn");
    noteEl.style.color = "var(--ink-soft)";

    if (r.status === "processing") {
      noteEl.textContent = "Still analyzing this report - check back shortly.";
    } else if (r.status === "failed") {
      noteEl.style.color = "var(--danger)";
      noteEl.textContent = "Analysis failed: " + (r.error_message || "unknown error");
    } else if (r.error_message) {
      noteEl.style.color = "var(--danger)";
      noteEl.textContent = r.error_message;
    } else if (r.extraction_method === "ocr") {
      noteEl.textContent = "This looked like a scan or photo, so its text was read with Gemini.";
    }

    document.getElementById("detailSummary").innerHTML = r.summary
      ? r.summary.replace(/\n/g, "<br>")
      : '<span style="color:var(--ink-faint);">No summary yet.</span>';

    // Offer a retry whenever something didn't work (no summary, or failed).
    retryBtn.style.display = !r.summary || r.status === "failed" ? "inline-flex" : "none";
    retryBtn.disabled = false;
    retryBtn.textContent = "Retry analysis";
    retryBtn.onclick = async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "Analyzing...";
      try {
        await api("/reports/" + id + "/reprocess", { method: "POST" });
      } catch (err) {
        noteEl.style.color = "var(--danger)";
        noteEl.textContent = err.message;
      }
      openReport(id);
    };

    if (r.specialist) {
      document.getElementById("detailSpecialistBox").style.display = "block";
      document.getElementById("detailSpecialist").textContent = r.specialist;
      document.getElementById("detailSpecialistReason").textContent = r.specialist_reason || "";
    }

    await loadChatHistory(id);
  } catch (err) {
    document.getElementById("detailSummary").innerHTML = `<span style="color:var(--danger);">${err.message}</span>`;
  }
}

async function loadChatHistory(reportId) {
  const log = document.getElementById("chatLog");
  try {
    const data = await api(`/chat/${reportId}`);
    if (!data) return;
    log.innerHTML = "";
    data.messages.forEach((m) => appendChatMessage(m.role, m.message));
  } catch (err) {
    console.error(err);
  }
}

function appendChatMessage(role, text) {
  const log = document.getElementById("chatLog");
  const bubble = document.createElement("div");
  bubble.className = `msg ${role}`;
  bubble.textContent = text;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
}

document.getElementById("chatSend").addEventListener("click", sendChatMessage);
document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const question = input.value.trim();
  if (!question || !currentReportId) return;

  appendChatMessage("user", question);
  input.value = "";

  const thinkingBubble = document.createElement("div");
  thinkingBubble.className = "msg assistant";
  thinkingBubble.innerHTML = '<span class="spinner"></span>';
  document.getElementById("chatLog").appendChild(thinkingBubble);

  try {
    const data = await api(`/chat/${currentReportId}`, { method: "POST", body: { question } });
    thinkingBubble.textContent = data ? data.answer : "";
    if (data && data.sources && data.sources.length > 0) {
      const how = data.method === "embeddings" ? "semantic search (embeddings)" : "keyword search (TF-IDF fallback)";
      const list = data.sources
        .map((s) => "#" + s.chunk + (s.score !== null ? " (" + s.score + ")" : ""))
        .join(", ");
      const meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = "Retrieved via " + how + " \u00b7 report excerpts " + list;
      thinkingBubble.appendChild(meta);
    }
  } catch (err) {
    thinkingBubble.textContent = err.message;
  }
}

// =====================================================================
// Reminders
// =====================================================================
async function loadReminders() {
  loadEmailStatus();
  try {
    const data = await api("/reminders");
    if (!data) return;
    renderMedicineList(data.medicines);
  } catch (err) {
    console.error(err);
  }
}

async function loadEmailStatus() {
  const banner = document.getElementById("emailBanner");
  const text = document.getElementById("emailBannerText");
  const testBtn = document.getElementById("testEmailBtn");
  try {
    const st = await api("/reminders/email-status");
    if (!st) return;
    if (st.configured) {
      banner.className = "email-banner on";
      text.textContent = "Email reminders are ON. They are sent to " + st.to + " (from " + st.from + ") while MedAssist is running.";
      testBtn.style.display = "inline-flex";
    } else {
      banner.className = "email-banner off";
      text.textContent = 'Email reminders are OFF. In the backend folder run "npm run setup:email", then restart the app.';
      testBtn.style.display = "none";
    }
  } catch (err) {
    text.textContent = "Couldn't check email settings: " + err.message;
  }
}

document.getElementById("testEmailBtn").addEventListener("click", async () => {
  const btn = document.getElementById("testEmailBtn");
  const text = document.getElementById("emailBannerText");
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const r = await api("/reminders/test-email", { method: "POST" });
    text.innerHTML = '<span class="ok">Test email sent to ' + esc(r.to) + ". Check your inbox (and spam folder).</span>";
  } catch (err) {
    text.innerHTML = '<span class="bad">Couldn\'t send: ' + esc(err.message) + "</span>";
  }
  btn.disabled = false;
  btn.textContent = "Send test email";
});

function renderMedicineList(medicines) {
  const list = document.getElementById("medicineList");
  list.innerHTML = "";

  if (medicines.length === 0) {
    list.innerHTML = '<div class="empty-note">No medicines added yet.</div>';
    return;
  }

  medicines.forEach((m) => {
    const item = document.createElement("div");
    item.className = `medicine-item ${m.active ? "" : "inactive"}`;
    const parts = [m.dosage, m.frequency, m.time_of_day].filter(Boolean).join(" \u00b7 ");

    let timesLine;
    if (!m.active) timesLine = '<div class="times-line warn">Reminders stopped</div>';
    else if (m.times_display && m.times_display.length)
      timesLine = '<div class="times-line">Email reminders at ' + esc(m.times_display.join(", ")) + "</div>";
    else timesLine = '<div class="times-line warn">No email reminder - write times like 8:00 AM, 8:00 PM</div>';

    item.innerHTML = `
      <div>
        <div class="name">${esc(m.name)}</div>
        <div class="detail">${esc(parts) || "No schedule details"}</div>
        ${m.notes ? `<div class="detail">${esc(m.notes)}</div>` : ""}
        ${timesLine}
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn secondary" data-action="toggle" data-id="${m.id}" data-active="${m.active}">
          ${m.active ? "Mark done" : "Reactivate"}
        </button>
        <button class="btn danger" data-action="delete" data-id="${m.id}">Delete</button>
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const active = btn.dataset.active === "1" ? 0 : 1;
      await api(`/reminders/${btn.dataset.id}`, { method: "PATCH", body: { active } });
      loadReminders();
    });
  });
  list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/reminders/${btn.dataset.id}`, { method: "DELETE" });
      loadReminders();
    });
  });
}

document.getElementById("medicineForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("medName").value,
    dosage: document.getElementById("medDosage").value,
    frequency: document.getElementById("medFrequency").value,
    time_of_day: document.getElementById("medTime").value,
    start_date: document.getElementById("medStart").value,
    end_date: document.getElementById("medEnd").value,
    notes: document.getElementById("medNotes").value,
  };
  try {
    await api("/reminders", { method: "POST", body });
    e.target.reset();
    loadReminders();
  } catch (err) {
    alert(err.message);
  }
});

// =====================================================================
// Specialist finder
// =====================================================================
document.getElementById("symptomsBtn").addEventListener("click", async () => {
  const symptoms = document.getElementById("symptomsInput").value.trim();
  const resultBox = document.getElementById("symptomsResult");
  if (!symptoms) return;

  resultBox.innerHTML = '<span class="spinner"></span> Thinking…';
  try {
    const data = await api("/specialist/symptoms", { method: "POST", body: { symptoms } });
    resultBox.innerHTML = `
      <div style="font-family:'IBM Plex Mono',monospace; font-size:0.75rem; color:var(--ink-faint); margin-bottom:6px;">suggested specialist</div>
      <span class="pill-result">${data.specialist}</span>
      <p style="color:var(--ink-soft); font-size:0.9rem; margin-top:10px;">${data.reason}</p>
    `;
  } catch (err) {
    resultBox.innerHTML = `<span style="color:var(--danger);">${err.message}</span>`;
  }
});

// ---------- initial load ----------
loadDashboard();
