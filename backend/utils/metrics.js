// metrics.js — pulls a handful of common lab values out of report text with
// pattern matching, so the dashboard has real numbers to chart. This is a
// deliberately small, extensible list rather than a full medical NLP model.

const METRIC_PATTERNS = [
  { name: "Hemoglobin", unit: "g/dL", pattern: /h(?:a)?emoglobin[^0-9]{0,15}(\d{1,2}(?:\.\d+)?)/i },
  { name: "Blood Glucose (Fasting)", unit: "mg/dL", pattern: /(?:fasting\s+)?(?:blood\s+)?glucose[^0-9]{0,15}(\d{2,3}(?:\.\d+)?)/i },
  { name: "Total Cholesterol", unit: "mg/dL", pattern: /total\s+cholesterol[^0-9]{0,15}(\d{2,3}(?:\.\d+)?)/i },
  { name: "LDL Cholesterol", unit: "mg/dL", pattern: /ldl(?:\s+cholesterol)?[^0-9]{0,15}(\d{2,3}(?:\.\d+)?)/i },
  { name: "HDL Cholesterol", unit: "mg/dL", pattern: /hdl(?:\s+cholesterol)?[^0-9]{0,15}(\d{2,3}(?:\.\d+)?)/i },
  { name: "Triglycerides", unit: "mg/dL", pattern: /triglycerides[^0-9]{0,15}(\d{2,4}(?:\.\d+)?)/i },
  { name: "Systolic BP", unit: "mmHg", pattern: /blood\s+pressure[^0-9]{0,10}(\d{2,3})\s*\/\s*\d{2,3}/i },
  { name: "Diastolic BP", unit: "mmHg", pattern: /blood\s+pressure[^0-9]{0,10}\d{2,3}\s*\/\s*(\d{2,3})/i },
  { name: "TSH", unit: "mIU/L", pattern: /tsh[^0-9]{0,15}(\d{1,3}(?:\.\d+)?)/i },
  { name: "Creatinine", unit: "mg/dL", pattern: /creatinine[^0-9]{0,15}(\d{1,2}(?:\.\d+)?)/i },
  { name: "Vitamin D", unit: "ng/mL", pattern: /vitamin\s*d[^0-9]{0,15}(\d{1,3}(?:\.\d+)?)/i },
  { name: "BMI", unit: "kg/m²", pattern: /bmi[^0-9]{0,10}(\d{1,2}(?:\.\d+)?)/i },
  { name: "Heart Rate", unit: "bpm", pattern: /(?:heart\s+rate|pulse)[^0-9]{0,10}(\d{2,3})/i },
];

/**
 * Returns an array of { name, value, unit } for every recognized metric
 * found in the given text. Silently skips anything it doesn't recognize —
 * unmatched values simply won't appear on the dashboard.
 */
function extractMetrics(text) {
  if (!text) return [];
  const found = [];
  for (const { name, unit, pattern } of METRIC_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (!Number.isNaN(value)) {
        found.push({ name, value, unit });
      }
    }
  }
  return found;
}

module.exports = { extractMetrics };
