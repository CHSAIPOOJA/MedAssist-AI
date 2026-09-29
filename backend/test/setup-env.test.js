const test = require("node:test");
const assert = require("node:assert");
const { cleanValue, parseEnv, isPlaceholder, upsertEnv, validateKey } = require("../scripts/setup-env");

test("cleanValue fixes doubled names, quotes and spaces", () => {
  assert.strictEqual(cleanValue("JWT_SECRET", " JWT_SECRET=abc123 "), "abc123");
  assert.strictEqual(cleanValue("GEMINI_API_KEY", '"AIza-key"'), "AIza-key");
  assert.strictEqual(cleanValue("X", "'quoted'"), "quoted");
});

test("parseEnv reads the exact broken file from the user", () => {
  const env = parseEnv("# c\nPORT=4000\nJWT_SECRET=JWT_SECRET=kl9X\nGEMINI_API_KEY=your_gemini_api_key_here\r\n");
  assert.strictEqual(env.PORT, "4000");
  assert.strictEqual(env.JWT_SECRET, "kl9X");
  assert.ok(isPlaceholder(env.GEMINI_API_KEY));
});

test("isPlaceholder", () => {
  ["", undefined, "your_gemini_api_key_here", "change_this_to_a_long_random_string", "paste_key_here"].forEach((v) =>
    assert.ok(isPlaceholder(v), String(v)));
  ["AIzaSyABC", "AQ.Ab8RN6J", "kl9Xv2QpR7"].forEach((v) => assert.ok(!isPlaceholder(v), v));
});

test("upsertEnv replaces, appends, keeps comments", () => {
  const out = upsertEnv("# keep me\nPORT=4000\nJWT_SECRET=old\n", { JWT_SECRET: "new", GEMINI_API_KEY: "k" });
  assert.match(out, /# keep me/);
  assert.match(out, /JWT_SECRET=new/);
  assert.doesNotMatch(out, /JWT_SECRET=old/);
  assert.match(out, /GEMINI_API_KEY=k\n$/);
});

test("validateKey: accepted / rejected by Google / proxy / offline", async () => {
  const mk = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  assert.strictEqual((await validateKey("k", mk(200, {}))).ok, true);
  const bad = await validateKey("k", mk(400, { error: { message: "API key not valid." } }));
  assert.strictEqual(bad.ok, false);
  assert.match(bad.message, /not valid/);
  // firewall/proxy answers with no Google error body -> must NOT reject the key
  assert.strictEqual((await validateKey("k", async () => ({ ok: false, status: 403, json: async () => { throw new Error("html"); } }))).ok, null);
  assert.strictEqual((await validateKey("k", async () => { throw new Error("offline"); })).ok, null);
});

const { cleanAppPassword, verifyEmail } = require("../scripts/setup-env");

test("cleanAppPassword removes the spaces Google shows", () => {
  assert.strictEqual(cleanAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
  assert.strictEqual(cleanAppPassword(' "abcd efgh" '), "abcdefgh");
});

test("verifyEmail: accepted / login refused / network problem", async () => {
  const lib = (verify) => ({ createTransport: () => ({ verify }) });
  assert.strictEqual((await verifyEmail({ user: "a@gmail.com", pass: "p" }, lib(async () => true))).ok, true);
  const refused = await verifyEmail({ user: "a@gmail.com", pass: "p" }, lib(async () => { const e = new Error("Invalid login"); e.code = "EAUTH"; throw e; }));
  assert.strictEqual(refused.ok, false);
  assert.match(refused.message, /App Password/);
  const offline = await verifyEmail({ user: "a@gmail.com", pass: "p" }, lib(async () => { const e = new Error("x"); e.code = "ETIMEDOUT"; throw e; }));
  assert.strictEqual(offline.ok, null);
});
