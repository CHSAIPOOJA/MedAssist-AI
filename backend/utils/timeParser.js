// timeParser.js — turns the free-text "Time of day" box into real clock times.
//   "10am and 8pm"        -> ["10:00", "20:00"]
//   "8:00 AM, 8:00 PM"    -> ["08:00", "20:00"]
//   "08:00 20:00"         -> ["08:00", "20:00"]
//   "morning and night"   -> ["08:00", "21:00"]
// A bare number like "500" is ignored on purpose (it could be a dose).

const WORDS = {
  morning: "08:00", breakfast: "08:00", noon: "12:00", lunch: "13:00",
  afternoon: "14:00", evening: "18:00", dinner: "20:00", night: "21:00", bedtime: "22:00",
};

const pad = (n) => String(n).padStart(2, "0");

function parseTimes(text) {
  const s = String(text || "").toLowerCase();
  const found = new Set();

  // 8am | 8 pm | 8:30 pm | 8.30 pm | 08:00 | 20:00   (not part of a longer number)
  // A dot is only accepted before am/pm, so a dose like "0.25" is never a time.
  const re = /(?<![\d:.])(\d{1,2})(?:(?::(\d{2}))|(?:\.(\d{2})(?=\s*[ap]\.?m(?![a-z]))))?(?:\s*(a\.?m\.?|p\.?m\.?)(?![a-z]))?(?!\d)/g;
  let m;
  while ((m = re.exec(s))) {
    const meridiem = m[4] ? m[4][0] : null; // "a" | "p" | null
    const minuteText = m[2] !== undefined ? m[2] : m[3];
    const hasMinutes = minuteText !== undefined;
    if (!meridiem && !hasMinutes) continue; // bare number: ambiguous, ignore

    let hour = parseInt(m[1], 10);
    const minute = hasMinutes ? parseInt(minuteText, 10) : 0;
    if (minute > 59) continue;

    if (meridiem) {
      if (hour < 1 || hour > 12) continue;
      if (meridiem === "a") hour = hour === 12 ? 0 : hour;
      else hour = hour === 12 ? 12 : hour + 12;
    } else if (hour > 23) {
      continue;
    }
    found.add(`${pad(hour)}:${pad(minute)}`);
  }

  for (const [word, time] of Object.entries(WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(s)) found.add(time);
  }

  return [...found].sort();
}

/** "20:00" -> "8:00 PM" */
function formatTime12(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${suffix}`;
}

module.exports = { parseTimes, formatTime12 };
