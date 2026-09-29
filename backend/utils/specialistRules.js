// specialistRules.js — a transparent, rule-based recommender.
//
// A capstone project like this is better served by rules a reviewer can read
// and trust than by a black-box classifier trained on too little data. Each
// rule is a specialist plus the keywords that point to them; the first rule
// with the most keyword hits wins.

const RULES = [
  {
    specialist: "Cardiologist",
    keywords: ["heart", "cardiac", "chest pain", "cholesterol", "triglyceride", "blood pressure", "hypertension", "palpitation", "ecg", "ekg"],
  },
  {
    specialist: "Endocrinologist",
    keywords: ["glucose", "diabetes", "diabetic", "thyroid", "tsh", "insulin", "hba1c", "hormone"],
  },
  {
    specialist: "Nephrologist",
    keywords: ["kidney", "renal", "creatinine", "urea", "dialysis"],
  },
  {
    specialist: "Pulmonologist",
    keywords: ["lung", "breath", "asthma", "cough", "pneumonia", "oxygen saturation", "spo2", "bronch"],
  },
  {
    specialist: "Gastroenterologist",
    keywords: ["stomach", "abdominal", "liver", "digestion", "nausea", "vomiting", "bowel", "hepatic"],
  },
  {
    specialist: "Dermatologist",
    keywords: ["skin", "rash", "acne", "itching", "eczema", "dermat"],
  },
  {
    specialist: "Orthopedist",
    keywords: ["bone", "fracture", "joint", "arthritis", "spine", "orthopedic"],
  },
  {
    specialist: "Neurologist",
    keywords: ["headache", "migraine", "seizure", "numbness", "nerve", "neuro"],
  },
  {
    specialist: "Hematologist",
    keywords: ["hemoglobin", "anemia", "platelet", "wbc", "blood cell", "hematolog"],
  },
];

/**
 * Scores each specialist rule against the given text and returns the best
 * match, or a General Physician fallback with a neutral reason when nothing
 * scores highly enough to be confident.
 */
function recommendSpecialist(text) {
  const lower = (text || "").toLowerCase();
  if (!lower.trim()) {
    return {
      specialist: "General Physician",
      reason: "No report text was available to analyze yet.",
    };
  }

  let best = null;
  for (const rule of RULES) {
    const matched = rule.keywords.filter((kw) => lower.includes(kw));
    if (matched.length > 0 && (!best || matched.length > best.matched.length)) {
      best = { ...rule, matched };
    }
  }

  if (!best) {
    return {
      specialist: "General Physician",
      reason: "Nothing in the report pointed to a specific specialty — a general physician is the right starting point.",
    };
  }

  return {
    specialist: best.specialist,
    reason: `The report mentions ${best.matched.slice(0, 3).join(", ")}, which typically falls under ${best.specialist.toLowerCase()} care.`,
  };
}

module.exports = { recommendSpecialist };
