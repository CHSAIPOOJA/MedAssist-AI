const test = require("node:test");
const assert = require("node:assert");
const { parseTimes, formatTime12 } = require("../utils/timeParser");

const cases = [
  ["10am and 8pm", ["10:00", "20:00"]],
  ["8:00 AM, 8:00 PM", ["08:00", "20:00"]],
  ["10:00 AM and 8:00 PM", ["10:00", "20:00"]],
  ["11am, 5pm", ["11:00", "17:00"]],
  ["08:00 20:00", ["08:00", "20:00"]],
  ["7.30 pm", ["19:30"]],
  ["8.30pm and 9 am", ["09:00", "20:30"]],
  ["9 a.m. / 9 p.m.", ["09:00", "21:00"]],
  ["12am 12pm", ["00:00", "12:00"]],
  ["morning and night", ["08:00", "21:00"]],
  ["after lunch", ["13:00"]],
  ["8am 8am", ["08:00"]],
  ["500mg twice daily", []],
  ["0.25 mg", []],
  ["10 ampoules", []],
  ["2 times a day", []],
  ["9:75", []],
  ["25:00", []],
  ["13pm", []],
  ["", []],
  [null, []],
];
for (const [input, expected] of cases) {
  test(`parseTimes(${JSON.stringify(input)})`, () => assert.deepStrictEqual(parseTimes(input), expected));
}

test("formatTime12", () => {
  assert.strictEqual(formatTime12("00:05"), "12:05 AM");
  assert.strictEqual(formatTime12("12:00"), "12:00 PM");
  assert.strictEqual(formatTime12("20:00"), "8:00 PM");
  assert.strictEqual(formatTime12("09:30"), "9:30 AM");
});
