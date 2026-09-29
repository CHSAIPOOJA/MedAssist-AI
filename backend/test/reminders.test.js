// Tests for email reminders: mailer safety + the scheduler's timing rules.
// A fake SMTP transport records the emails instead of sending them.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "medassist-r-")), "t.db");
process.env.SMTP_USER = "sender@gmail.com";
process.env.SMTP_PASS = "abcdefghijklmnop";

const db = require("../db");
const mailer = require("../utils/mailer");
const scheduler = require("../utils/reminderScheduler");

let sentMail = [];
let failNext = 0;
mailer.setTransport({
  sendMail: async (msg) => {
    if (failNext > 0) { failNext--; const e = new Error("connect ETIMEDOUT"); e.code = "ETIMEDOUT"; throw e; }
    sentMail.push(msg);
    return { messageId: "x" };
  },
});
const reset = () => { sentMail = []; failNext = 0; db.exec("DELETE FROM reminder_log; DELETE FROM medicines;"); };

let seq = 0;
function user(email) {
  return Number(db.prepare("INSERT INTO users (name,email,password_hash) VALUES ('Pooja Sai', ?, 'x')").run(email || `u${++seq}@example.com`).lastInsertRowid);
}
function med(userId, o) {
  return Number(
    db.prepare("INSERT INTO medicines (user_id,name,dosage,time_of_day,start_date,end_date,notes,active) VALUES (?,?,?,?,?,?,?,?)")
      .run(userId, o.name, o.dosage || null, o.time, o.start || null, o.end || null, o.notes || null, o.active === 0 ? 0 : 1).lastInsertRowid
  );
}
// 28 Sep 2026, local time
const at = (h, m) => new Date(2026, 8, 28, h, m, 0);

test("mailer: rejects tricky/invalid recipient addresses", () => {
  ["a@b.com(x)@evil.com", '"a@evil.com"@good.com', "a@b.com, c@d.com", "<a@b.com>", "a b@c.com", "nope", "a@b", ""].forEach((bad) =>
    assert.strictEqual(mailer.isValidEmail(bad), false, bad));
  ["pooja.sai@gmail.com", "a+b@sub.example.co.in"].forEach((ok) => assert.strictEqual(mailer.isValidEmail(ok), true, ok));
});

test("mailer: refuses to send an invalid recipient, and explains login/network errors", async () => {
  await assert.rejects(() => mailer.sendMail({ to: "a@b.com(x)@evil.com", subject: "s", text: "t" }), /not a valid email/);
  assert.match(mailer.explainMailError({ code: "EAUTH", message: "Invalid login" }), /App Password/);
  assert.match(mailer.explainMailError({ code: "ETIMEDOUT", message: "x" }), /Couldn't connect/);
});

test("sends at the time, once, with the medicine name", async () => {
  reset();
  const u = user("pooja@example.com");
  med(u, { name: "L-Hist", dosage: "500mg", time: "10am and 8pm" });
  const r = await scheduler.tick(at(10, 0));
  assert.strictEqual(r.sent, 1);
  assert.strictEqual(sentMail.length, 1);
  assert.strictEqual(sentMail[0].to, "pooja@example.com");
  assert.match(sentMail[0].subject, /10:00 AM/);
  assert.match(sentMail[0].subject, /L-Hist \(500mg\)/);
  assert.match(sentMail[0].text, /Hi Pooja/);
  // same minute again, and a minute later: no duplicates
  await scheduler.tick(at(10, 0));
  await scheduler.tick(at(10, 1));
  assert.strictEqual(sentMail.length, 1);
  // the 8pm dose is a separate reminder
  await scheduler.tick(at(20, 0));
  assert.strictEqual(sentMail.length, 2);
  assert.match(sentMail[1].subject, /8:00 PM/);
});

test("not before the time; a few minutes late still sends; long after is skipped", async () => {
  reset();
  const u = user();
  med(u, { name: "Dolo", time: "11am" });
  await scheduler.tick(at(10, 59));
  assert.strictEqual(sentMail.length, 0, "too early");
  await scheduler.tick(at(11, 8));
  assert.strictEqual(sentMail.length, 1, "8 minutes late = catch-up");

  reset();
  const u2 = user();
  med(u2, { name: "Dolo", time: "11am" });
  await scheduler.tick(at(11, 30));
  assert.strictEqual(sentMail.length, 0, "30 minutes late = missed, not sent");
});

test("inactive, not-started and ended medicines never send; end date is inclusive", async () => {
  reset();
  const u = user();
  med(u, { name: "Stopped", time: "9am", active: 0 });
  med(u, { name: "Future", time: "9am", start: "2026-09-29" });
  med(u, { name: "Ended", time: "9am", end: "2026-09-27" });
  med(u, { name: "LastDay", time: "9am", end: "2026-09-28" });
  med(u, { name: "Started", time: "9am", start: "2026-09-28" });
  med(u, { name: "NoTime", time: "" });
  med(u, { name: "Unparseable", time: "twice daily" });
  await scheduler.tick(at(9, 0));
  assert.strictEqual(sentMail.length, 1);
  assert.match(sentMail[0].subject, /LastDay/);
  assert.match(sentMail[0].subject, /Started/);
  ["Stopped", "Future", "Ended", "NoTime", "Unparseable"].forEach((n) => assert.doesNotMatch(sentMail[0].subject, new RegExp(n)));
});

test("two medicines at the same time -> ONE email; different people -> separate emails", async () => {
  reset();
  const a = user("a@example.com");
  const b = user("b@example.com");
  med(a, { name: "MedA1", time: "8am" });
  med(a, { name: "MedA2", time: "8:00 AM" });
  med(b, { name: "MedB", time: "8am" });
  await scheduler.tick(at(8, 0));
  assert.strictEqual(sentMail.length, 2);
  const toA = sentMail.find((m) => m.to === "a@example.com");
  const toB = sentMail.find((m) => m.to === "b@example.com");
  assert.match(toA.subject, /MedA1/); assert.match(toA.subject, /MedA2/);
  assert.match(toB.subject, /MedB/); assert.doesNotMatch(toB.subject, /MedA/);
});

test("a failed send is retried on the next check, then not repeated", async () => {
  reset();
  const u = user();
  med(u, { name: "Retry", time: "7pm" });
  failNext = 1;
  const r1 = await scheduler.tick(at(19, 0));
  assert.strictEqual(r1.sent, 0);
  assert.match(scheduler.getLastError(), /Couldn't connect/);
  const r2 = await scheduler.tick(at(19, 1));
  assert.strictEqual(r2.sent, 1);
  await scheduler.tick(at(19, 2));
  assert.strictEqual(sentMail.length, 1);
});

test("when email isn't configured nothing is sent or logged", async () => {
  reset();
  const u = user();
  med(u, { name: "NoMail", time: "6am" });
  const saved = process.env.SMTP_PASS;
  delete process.env.SMTP_PASS;
  const r = await scheduler.tick(at(6, 0));
  process.env.SMTP_PASS = saved;
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(sentMail.length, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM reminder_log").get().n, 0);
  // once it IS configured the reminder still goes out (within the grace window)
  await scheduler.tick(at(6, 3));
  assert.strictEqual(sentMail.length, 1);
});

test("email body escapes HTML in medicine names; bad recipient doesn't crash the loop", async () => {
  reset();
  const u = user();
  med(u, { name: "<script>alert(1)</script>", time: "5am" });
  const bad = user("bad@x.com(y)@evil.com");
  med(bad, { name: "Ok", time: "5am" });
  await scheduler.tick(at(5, 0));
  assert.strictEqual(sentMail.length, 1, "only the valid recipient got mail");
  assert.doesNotMatch(sentMail[0].html, /<script>/);
  assert.match(sentMail[0].html, /&lt;script&gt;/);
});

test("deleting a medicine clears its reminder history", async () => {
  reset();
  const u = user();
  const id = med(u, { name: "Gone", time: "4am" });
  await scheduler.tick(at(4, 0));
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM reminder_log").get().n, 1);
  db.prepare("DELETE FROM medicines WHERE id=?").run(id);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM reminder_log").get().n, 0);
});
