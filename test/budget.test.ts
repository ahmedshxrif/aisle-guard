import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetGuard } from "../src/index.ts";

test("reservations count against the cap before the money is spent", () => {
  const budget = new BudgetGuard({ monthlyCapUsd: 1, reserveShare: 0 });
  const a = budget.tryReserve(0.6);
  assert.ok(a);
  assert.equal(budget.tryReserve(0.6), null, "a second call cannot spend the same money");
  budget.settle(a, 0.2);
  assert.ok(budget.tryReserve(0.6), "settling for less frees the difference");
});

test("a share of the cap is never spent", () => {
  const budget = new BudgetGuard({ monthlyCapUsd: 10, reserveShare: 0.1 });
  assert.equal(budget.remainingUsd(), 9);
  assert.equal(budget.tryReserve(9.5), null);
});

test("a released reservation gives the money back", () => {
  const budget = new BudgetGuard({ monthlyCapUsd: 1, reserveShare: 0 });
  const held = budget.tryReserve(1)!;
  budget.release(held);
  assert.equal(budget.remainingUsd(), 1);
});

test("the budget starts again each month", () => {
  let today = new Date("2026-01-31T12:00:00Z");
  const budget = new BudgetGuard({ monthlyCapUsd: 1, reserveShare: 0, now: () => today });
  budget.settle(budget.tryReserve(1)!, 1);
  assert.equal(budget.tryReserve(0.1), null);
  today = new Date("2026-02-01T00:00:01Z");
  assert.ok(budget.tryReserve(0.1));
});

test("a cap of zero is a mistake, not a setting", () => {
  assert.throws(() => new BudgetGuard({ monthlyCapUsd: 0 }), RangeError);
});
