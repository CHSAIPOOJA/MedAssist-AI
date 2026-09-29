const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/dashboard — overview counts + time series per metric for charts
router.get("/", requireAuth, (req, res) => {
  const userId = req.user.id;

  const reportCount = db
    .prepare("SELECT COUNT(*) AS n FROM reports WHERE user_id = ?")
    .get(userId).n;

  const activeMedicineCount = db
    .prepare("SELECT COUNT(*) AS n FROM medicines WHERE user_id = ? AND active = 1")
    .get(userId).n;

  const lastReport = db
    .prepare(
      "SELECT original_name, uploaded_at FROM reports WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT 1"
    )
    .get(userId);

  const rows = db
    .prepare(
      `SELECT metric_name, metric_value, unit, recorded_at
       FROM health_metrics WHERE user_id = ? ORDER BY recorded_at ASC`
    )
    .all(userId);

  const series = {};
  for (const row of rows) {
    if (!series[row.metric_name]) {
      series[row.metric_name] = { unit: row.unit, points: [] };
    }
    series[row.metric_name].points.push({ value: row.metric_value, date: row.recorded_at });
  }

  const specialistRows = db
    .prepare(
      `SELECT specialist, COUNT(*) AS n FROM reports
       WHERE user_id = ? AND specialist IS NOT NULL
       GROUP BY specialist ORDER BY n DESC`
    )
    .all(userId);

  res.json({
    reportCount,
    activeMedicineCount,
    lastReport: lastReport || null,
    metricSeries: series,
    specialistBreakdown: specialistRows,
  });
});

module.exports = router;
