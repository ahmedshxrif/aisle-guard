import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReply, findProduct, quantities } from "../src/index.ts";
import { run } from "../eval/run.ts";

const fridge = findProduct("fridge-650")!;
const rules = (reply: string) => checkReply(reply, [fridge]).violations.map((v) => v.rule);

test("a reply built from the spec sheet passes", () => {
  assert.deepEqual(rules("It holds 650 litres and is 91.2 cm wide."), []);
});

test("prices are caught however they are written", () => {
  for (const reply of ["It's 2,199 dirhams.", "AED 2899 today", "$499"]) {
    assert.deepEqual(rules(reply), ["price"], reply);
  }
  assert.ok(rules("It costs 3500.").includes("price"));
  assert.ok(rules("It's 20% off.").includes("price"));
});

test("a number is only allowed when the spec sheet has it, in the same unit", () => {
  assert.deepEqual(rules("It holds 700 litres."), ["unsupported-number"]);
  assert.deepEqual(rules("It holds 650 kg."), ["unsupported-number"]);
  assert.deepEqual(rules("It holds 650 liters."), []);
});

test("extra numbers can be allowed, such as a fit calculation", () => {
  const verdict = checkReply("A 95 cm space leaves 3.8 cm to spare.", [fridge], { allowedNumbers: [{ value: 95, unit: "cm" }, { value: 3.8, unit: "cm" }] });
  assert.equal(verdict.ok, true);
});

test("competitor names and absolute claims are caught", () => {
  assert.deepEqual(rules("Better than the Frostline."), ["competitor"]);
  assert.deepEqual(rules("It never breaks."), ["absolute-claim"]);
});

test("the competitor list can be replaced", () => {
  assert.equal(checkReply("Better than Acme.", [fridge], { competitors: ["Acme"] }).ok, false);
  assert.equal(checkReply("Better than Frostline.", [fridge], { competitors: ["Acme"] }).ok, true);
});

test("long replies are caught, because they will be spoken", () => {
  assert.deepEqual(rules("It is big. It is quiet. It is tall. It is wide."), ["too-long"]);
});

test("quantities reads numbers with their units", () => {
  assert.deepEqual(quantities("650 litres, 39 dB and 91,2 cm").map((q) => [q.value, q.unit]), [[650, "l"], [39, "db"], [91.2, "cm"]]);
});

test("every labelled case in the eval set gets the right verdict", () => {
  const result = run();
  assert.deepEqual(result.misses, []);
  assert.ok(result.total >= 44);
});

test("a price in words is still a price", () => {
  assert.deepEqual(rules("About two thousand dirhams."), ["price"]);
});

test("a number is read whole, never from its last digits", () => {
  assert.deepEqual(quantities("1 650 litres").map((q) => q.value), [1650]);
  assert.deepEqual(quantities("1,650 litres").map((q) => q.value), [1650]);
  assert.deepEqual(rules("It holds 1 650 litres."), ["unsupported-number"]);
});

test("figures spelled out cannot be checked, so they are blocked", () => {
  assert.deepEqual(rules("It runs at twenty decibels."), ["unsupported-number"]);
  assert.deepEqual(rules("A family of five will love it."), []);
});

test("digits in other scripts and hidden characters do not get past the rules", () => {
  assert.ok(rules("It's \u0662\u066c\u0661\u0669\u0669 dirhams.").includes("price"));
  assert.ok(rules("Only 2,199 dir\u200bhams.").includes("price"));
});

test("a reply the rules cannot read is blocked, not waved through", () => {
  assert.deepEqual(rules("\u0633\u0639\u0631\u0647\u0627 \u0623\u0644\u0641\u064a\u0646"), ["unreadable"]);
});

test("a number with an unknown unit, or no unit, fails closed", () => {
  assert.deepEqual(rules("It uses 30% less energy."), ["unsupported-number"]);
  assert.deepEqual(rules("It has 4 shelves."), ["unsupported-number"]);
  assert.equal(checkReply("Perfect for 5 people.", [fridge], { allowedPlainNumbers: [5] }).ok, true);
});

test("a brand name is caught however it is spaced or hyphenated", () => {
  assert.deepEqual(rules("It beats the Frost-line."), ["competitor"]);
  assert.deepEqual(rules("Better than F r o s t l i n e."), ["competitor"]);
});

test("a price spelled out is caught without a currency word", () => {
  assert.deepEqual(rules("It costs about two thousand."), ["price"]);
  assert.deepEqual(rules("It's fifty percent off."), ["price"]);
});
