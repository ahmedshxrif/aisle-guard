// Runs every labelled reply in replies.json through the guardrails and reports how many verdicts match.
// The same cases run in the test suite, so a rule change that breaks one fails the build.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkReply, findProduct, type Rule } from "../src/index.ts";

export interface Case {
  reply: string;
  product: string;
  expect: Rule[];
}

export function loadCases(): Case[] {
  return JSON.parse(readFileSync(new URL("./replies.json", import.meta.url), "utf8"));
}

export function run(cases: Case[] = loadCases()): { passed: number; total: number; misses: string[] } {
  const misses: string[] = [];
  for (const c of cases) {
    const got = [...new Set(checkReply(c.reply, [findProduct(c.product)!]).violations.map((v) => v.rule))].sort();
    const want = [...c.expect].sort();
    if (got.join() !== want.join()) misses.push(`"${c.reply}" expected [${want}] got [${got}]`);
  }
  return { passed: cases.length - misses.length, total: cases.length, misses };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run();
  for (const miss of result.misses) console.log(`MISS ${miss}`);
  console.log(`${result.passed} of ${result.total} verdicts correct`);
  process.exit(result.misses.length ? 1 : 0);
}
