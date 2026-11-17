import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, checkReply, loadCatalog, loadPolicy, parseCatalog, parsePolicy } from "../src/index.ts";
import { parseChatArgs, parseCheckArgs } from "../src/check.ts";

const cli = (args: string[], input?: string) =>
  spawnSync(process.execPath, ["src/cli.ts", ...args], { input, encoding: "utf8" });
const tmp = (name: string, content: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "aisle-")), name);
  writeFileSync(file, content);
  return file;
};
const product = { id: "p", name: "P", category: "washer", specs: [{ label: "Capacity", value: 8, unit: "kg" }], features: [] };

test("the example catalogue loads", () => {
  const products = loadCatalog("examples/products.json");
  assert.ok(products.length >= 3);
  assert.ok(products.some((p) => p.id === "dryer-9"));
});

test("the example policy loads", () => {
  const policy = loadPolicy("examples/policy.json");
  assert.deepEqual(policy.competitors, ["Frostline", "Coolmax", "Nordwash", "Brand X"]);
  assert.equal(policy.maxSentences, 3);
});

test("a catalogue error names the bad field", () => {
  const bad = structuredClone([product]);
  (bad[0]!.specs[0] as { unit: string }).unit = "stone";
  assert.throws(() => parseCatalog(bad), (e: Error) => e instanceof ConfigError && e.message.startsWith("catalog[0].specs[0].unit: must be one of"));
  assert.throws(() => parseCatalog([{ ...product, category: "oven" }]), /catalog\[0\]\.category/);
  assert.throws(() => parseCatalog([{ ...product, id: "" }]), /catalog\[0\]\.id: must be a non-empty string/);
  assert.throws(() => parseCatalog([{ ...product, specs: [{ label: "x", value: "8", unit: "kg" }] }]), /specs\[0\]\.value: must be a number/);
  assert.throws(() => parseCatalog({}), /catalog: must be a list/);
  assert.throws(() => parseCatalog([]), /at least one product/);
  assert.throws(() => parseCatalog([product, product]), /catalog\[1\]\.id: "p" is used twice/);
});

test("a policy error names the bad field", () => {
  assert.throws(() => parsePolicy({ maxSentences: 0 }), /policy\.maxSentences/);
  assert.throws(() => parsePolicy({ maxSentences: 2.5 }), /policy\.maxSentences/);
  assert.throws(() => parsePolicy({ competitors: ["Acme", 7] }), /policy\.competitors\[1\]/);
  assert.throws(() => parsePolicy({ competitors: ["اكمي"] }), /policy\.competitors\[0\]: needs at least one Latin/);
  assert.throws(() => parsePolicy({ allowedNumbers: [{ value: 3, unit: "mile" }] }), /policy\.allowedNumbers\[0\]\.unit/);
  assert.throws(() => parsePolicy({ allowedPlainNumbers: ["2"] }), /policy\.allowedPlainNumbers\[0\]/);
  assert.throws(() => parsePolicy({ competitor: [] }), /policy\.competitor: unknown field/);
  assert.throws(() => parsePolicy([]), /policy: must be an object/);
});

test("a policy with only some fields leaves the rest to the defaults", () => {
  const policy = parsePolicy({ competitors: ["Acme"] });
  assert.deepEqual(policy, { competitors: ["Acme"] });
  assert.equal(checkReply("Acme is worse.", [], policy).ok, false);
  assert.equal(checkReply("Frostline is worse.", [], policy).ok, true);
});

test("a file that is missing or not JSON gives a readable error", () => {
  assert.throws(() => loadCatalog("/no/such/file.json"), /Cannot read file: \/no\/such\/file\.json/);
  const file = tmp("broken.json", "{ nope");
  assert.throws(() => loadPolicy(file), (e: Error) => e instanceof ConfigError && e.message.includes("is not valid JSON"));
});

test("a field error also names the file", () => {
  const file = tmp("policy.json", '{"maxSentences": "three"}');
  assert.throws(() => loadPolicy(file), (e: Error) => e.message.startsWith(file) && e.message.includes("policy.maxSentences"));
});

test("--catalog and --policy are parsed for check and chat", () => {
  assert.deepEqual(parseCheckArgs(["--catalog", "a.json", "hi", "--policy", "b.json"]), { json: false, catalog: "a.json", policy: "b.json", reply: "hi" });
  assert.deepEqual(parseChatArgs(["--policy", "b.json"]), { policy: "b.json" });
  assert.deepEqual(parseChatArgs([]), {});
});

test("check uses the products from --catalog", () => {
  // 9 kg is on the dryer's sheet in the example file, and on no built-in product.
  const withFile = cli(["check", "It holds 9 kg.", "--product", "dryer-9", "--catalog", "examples/products.json"]);
  assert.equal(withFile.status, 0, withFile.stderr);
  const without = cli(["check", "It holds 9 kg."]);
  assert.equal(without.status, 1);
  assert.equal(cli(["check", "hi", "--product", "dryer-9"]).status, 2);
});

test("check uses the competitors from --policy", () => {
  const file = tmp("policy.json", '{"competitors": ["Acme"]}');
  assert.equal(cli(["check", "Acme is worse.", "--policy", file]).status, 1);
  assert.equal(cli(["check", "Frostline is worse.", "--policy", file]).status, 0);
});

test("check with both example files runs", () => {
  const result = cli(["check", "It holds 650 litres.", "--product", "fridge-650", "--catalog", "examples/products.json", "--policy", "examples/policy.json"]);
  assert.equal(result.status, 0, result.stderr);
});

test("a broken file stops check with exit 2 and a message naming the field", () => {
  const file = tmp("products.json", JSON.stringify([{ ...product, category: "oven" }]));
  const result = cli(["check", "hello", "--catalog", file]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /catalog\[0\]\.category: must be one of/);
  assert.equal(cli(["check", "hello", "--policy", "/no/such.json"]).status, 2);
});

test("chat reads the files too, and stops on a broken one", () => {
  const file = tmp("policy.json", '{"maxSentences": -1}');
  const bad = cli(["chat", "--policy", file], "");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /policy\.maxSentences/);
  const ok = cli(["chat", "--catalog", "examples/products.json", "--policy", "examples/policy.json"], "");
  assert.equal(ok.status, 0, ok.stderr);
});
