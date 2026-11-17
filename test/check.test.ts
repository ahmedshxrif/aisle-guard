import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalog, findProduct } from "../src/index.ts";
import { checkReplies, parseCheckArgs, splitReplies } from "../src/check.ts";

const fridge = findProduct("fridge-650")!;
const mixed = "It holds 650 litres.\nIt never breaks and costs 999 dirhams.\n\nIt is 91.2 cm wide.\n";
const cli = (args: string[], input?: string) =>
  spawnSync(process.execPath, ["src/cli.ts", "check", ...args], { input, encoding: "utf8" });

test("arguments are parsed in any order", () => {
  const a = parseCheckArgs(["--json", "hello", "--product", "fridge-650", "world"]);
  assert.deepEqual(a, { json: true, product: "fridge-650", reply: "hello world" });
});

test("replies are split by line, skipping blanks and carriage returns", () => {
  assert.deepEqual(splitReplies("a\r\n\n  \nb\n"), ["a", "b"]);
});

test("json output has one object per reply", () => {
  const replies = splitReplies(mixed);
  const result = checkReplies(replies, [fridge], true);
  const rows = result.output.split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.ok), [true, false, true]);
  assert.deepEqual(rows[1].violations.map((v: { rule: string }) => v.rule).sort(), ["absolute-claim", "price"]);
  assert.equal(rows[0].reply, "It holds 650 litres.");
  assert.equal(result.blocked, true);
});

test("a single reply keeps the original text output", () => {
  assert.equal(checkReplies(["It holds 650 litres."], [fridge], false).output, "OK: this reply can be spoken.");
});

test("a file of mixed replies exits 1 and names the bad line", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ag-")), "replies.txt");
  writeFileSync(file, mixed);
  const r = cli(["--file", file, "--product", "fridge-650"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /OK \(line 1\)/);
  assert.match(r.stdout, /BLOCKED \(line 2\)/);
  assert.match(r.stdout, /\[price\]/);
});

test("standard input works when no reply is given", () => {
  const r = cli(["--json", "--product", "fridge-650"], mixed);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim().split("\n").length, 3);
  const clean = cli(["--json", "--product", "fridge-650"], "It holds 650 litres.\n");
  assert.equal(clean.status, 0);
  assert.equal(JSON.parse(clean.stdout).ok, true);
});

test("a missing file and empty input are usage errors", () => {
  assert.equal(cli(["--file", "/nonexistent/x.txt"]).status, 2);
  assert.equal(cli([], "\n\n").status, 2);
});

test("the argument form still works", () => {
  const r = cli(["It never breaks and costs 999 dirhams", "--product", "fridge-650"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^BLOCKED:/);
  assert.ok(catalog.length > 0);
});
