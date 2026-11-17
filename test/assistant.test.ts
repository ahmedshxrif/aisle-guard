import { test } from "node:test";
import assert from "node:assert/strict";
import { answer, BudgetGuard, scriptedModel, willItFit, findProduct, type Session } from "../src/index.ts";

const fresh = (): Session => ({ history: [] });
const never = scriptedModel(() => { throw new Error("the model should not be called"); });

test("price questions never reach the model", async () => {
  const result = await answer("How much is the fridge?", fresh(), { model: never });
  assert.equal(result.source, "rule");
  assert.match(result.text, /counter/);
});

test("the server works out whether it fits", async () => {
  const session = fresh();
  const no = await answer("Will the fridge fit in a 90 cm space?", session, { model: never });
  assert.equal(no.source, "rule");
  assert.match(no.text, /^No/);
  const yes = await answer("And a 95 cm space, will it fit?", session, { model: never });
  assert.match(yes.text, /^Yes/);
  assert.match(yes.text, /3\.8 cm to spare/);
});

test("fit needs room to breathe", () => {
  const fridge = findProduct("fridge-650")!;
  assert.equal(willItFit(fridge, 92).fits, false);
  assert.equal(willItFit(fridge, 93.2).fits, true);
});

test("a clean model reply is spoken as it is", async () => {
  const model = scriptedModel(() => "It holds 650 l, enough for a weekly shop.");
  const result = await answer("Tell me about the fridge", fresh(), { model });
  assert.equal(result.source, "model");
  assert.deepEqual(result.caught, []);
});

test("a bad reply gets one second chance, with the broken rules spelled out", async () => {
  const seen: string[] = [];
  const model = scriptedModel(({ messages }) => {
    const last = messages.at(-1)!.content;
    seen.push(last);
    return last.includes("broke these rules") ? "It runs at 39 db, so it is quiet." : "It never breaks and beats the Frostline.";
  });
  const result = await answer("Is the fridge quiet?", fresh(), { model });
  assert.equal(result.source, "retry");
  assert.equal(result.text, "It runs at 39 db, so it is quiet.");
  assert.deepEqual(result.caught.map((v) => v.rule).sort(), ["absolute-claim", "competitor"]);
  assert.match(seen[1]!, /Never name another brand/);
});

test("two bad replies fall back to facts from the spec sheet", async () => {
  const model = scriptedModel(() => "It's only 999 dirhams!");
  const result = await answer("Tell me about the fridge", fresh(), { model });
  assert.equal(result.source, "fallback");
  assert.match(result.text, /650 l/);
  assert.equal(result.caught.length, 2);
});

test("a model that fails still leaves the shopper with a true answer", async () => {
  const model = scriptedModel(() => { throw new Error("timeout"); });
  const result = await answer("Tell me about the washer", fresh(), { model });
  assert.equal(result.source, "fallback");
  assert.match(result.text, /11 kg/);
});

test("the conversation keeps its focus and its history", async () => {
  const session = fresh();
  const model = scriptedModel(() => "It takes 11 kg in one load.");
  await answer("I need a washer", session, { model });
  await answer("Is it big?", session, { model });
  assert.equal(session.focus?.id, "washer-11");
  assert.equal(session.history.length, 4);
});

test("no budget, no model call", async () => {
  const budget = new BudgetGuard({ monthlyCapUsd: 0.001, reserveShare: 0 });
  const result = await answer("Tell me about the fridge", fresh(), { model: never, budget, costPerCallUsd: 0.002 });
  assert.equal(result.source, "fallback");
});

test("the retry is paid for separately, so it cannot overspend", async () => {
  // Enough budget for exactly one call: the first reply is bad, and the retry must not happen.
  const budget = new BudgetGuard({ monthlyCapUsd: 0.003, reserveShare: 0 });
  let calls = 0;
  const model = scriptedModel(() => { calls += 1; return "It never breaks."; });
  const result = await answer("Tell me about the fridge", fresh(), { model, budget, costPerCallUsd: 0.002 });
  assert.equal(calls, 1);
  assert.equal(result.source, "fallback");
  assert.ok(budget.committedUsd() <= 0.003);
});

test("only recent turns are sent to the model", async () => {
  const session = fresh();
  for (let i = 0; i < 20; i++) session.history.push({ role: "user", content: `q${i}` }, { role: "assistant", content: `a${i}` });
  let sent = 0;
  const model = scriptedModel(({ messages }) => { sent = messages.length; return "It holds 650 l."; });
  await answer("Tell me about the fridge", session, { model });
  assert.equal(sent, 13);
});

test("a very long question is not sent to the model", async () => {
  const result = await answer("fridge ".repeat(200), fresh(), { model: never });
  assert.equal(result.source, "rule");
});
