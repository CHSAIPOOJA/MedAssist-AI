const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { recommendSpecialist } = require("../utils/specialistRules");

const router = express.Router();

// POST /api/specialist/symptoms — recommend a specialist from free-text symptoms,
// independent of any uploaded report.
router.post("/symptoms", requireAuth, (req, res) => {
  const { symptoms } = req.body || {};
  if (!symptoms || !symptoms.trim()) {
    return res.status(400).json({ error: "Describe your symptoms first." });
  }

  const result = recommendSpecialist(symptoms);
  res.json(result);
});

module.exports = router;
