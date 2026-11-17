// Load a catalogue and a policy from JSON files. A file written by hand is easy to get wrong,
// so every field is checked and the error names the exact field that is bad.

import { readFileSync } from "node:fs";
import type { Product, Spec, Unit } from "./catalog.ts";
import type { Policy } from "./guardrails.ts";

export class ConfigError extends Error {}

const UNITS: Unit[] = ["l", "kg", "cm", "db", "kwh", "year", "minute", "star", "inch", "w"];
const CATEGORIES: Product["category"][] = ["refrigerator", "washer", "dryer"];

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, problem: string): never {
  throw new ConfigError(`${path}: ${problem}`);
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(path, "must be a non-empty string");
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a number");
  return value;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be a list");
  return value;
}

function object(value: unknown, path: string): Obj {
  if (!isObject(value)) fail(path, "must be an object");
  return value;
}

function unit(value: unknown, path: string): Unit {
  if (typeof value !== "string" || !UNITS.includes(value as Unit)) fail(path, `must be one of: ${UNITS.join(", ")}`);
  return value as Unit;
}

function parseSpec(value: unknown, path: string): Spec {
  const obj = object(value, path);
  return { label: text(obj.label, `${path}.label`), value: finite(obj.value, `${path}.value`), unit: unit(obj.unit, `${path}.unit`) };
}

function parseProduct(value: unknown, path: string): Product {
  const obj = object(value, path);
  const category = obj.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category as Product["category"])) fail(`${path}.category`, `must be one of: ${CATEGORIES.join(", ")}`);
  const specs = list(obj.specs, `${path}.specs`).map((s, i) => parseSpec(s, `${path}.specs[${i}]`));
  const features = list(obj.features ?? [], `${path}.features`).map((f, i) => text(f, `${path}.features[${i}]`));
  return { id: text(obj.id, `${path}.id`), name: text(obj.name, `${path}.name`), category: category as Product["category"], specs, features };
}

/** A catalogue is a list of products. Each product needs an id, name, category and specs. */
export function parseCatalog(data: unknown): Product[] {
  const products = list(data, "catalog").map((p, i) => parseProduct(p, `catalog[${i}]`));
  if (products.length === 0) fail("catalog", "must list at least one product");
  const seen = new Set<string>();
  products.forEach((p, i) => {
    if (seen.has(p.id)) fail(`catalog[${i}].id`, `"${p.id}" is used twice`);
    seen.add(p.id);
  });
  return products;
}

/** A policy may set any of the four policy fields. Fields left out keep their defaults. */
export function parsePolicy(data: unknown): Partial<Policy> {
  const obj = object(data, "policy");
  const known = ["competitors", "maxSentences", "allowedNumbers", "allowedPlainNumbers"];
  for (const key of Object.keys(obj)) if (!known.includes(key)) fail(`policy.${key}`, `unknown field. Known fields: ${known.join(", ")}`);
  const policy: Partial<Policy> = {};
  if (obj.competitors !== undefined) {
    policy.competitors = list(obj.competitors, "policy.competitors").map((c, i) => {
      const name = text(c, `policy.competitors[${i}]`);
      // The rules compare Latin letters and digits only, so any other name could never match.
      if (!/[a-z0-9]/i.test(name)) fail(`policy.competitors[${i}]`, "needs at least one Latin letter or digit, or it can never be matched");
      return name;
    });
  }
  if (obj.maxSentences !== undefined) {
    const n = finite(obj.maxSentences, "policy.maxSentences");
    if (!Number.isInteger(n) || n < 1) fail("policy.maxSentences", "must be a whole number of at least 1");
    policy.maxSentences = n;
  }
  if (obj.allowedNumbers !== undefined) {
    policy.allowedNumbers = list(obj.allowedNumbers, "policy.allowedNumbers").map((entry, i) => {
      const spec = object(entry, `policy.allowedNumbers[${i}]`);
      return { value: finite(spec.value, `policy.allowedNumbers[${i}].value`), unit: unit(spec.unit, `policy.allowedNumbers[${i}].unit`) };
    });
  }
  if (obj.allowedPlainNumbers !== undefined) {
    policy.allowedPlainNumbers = list(obj.allowedPlainNumbers, "policy.allowedPlainNumbers").map((n, i) => finite(n, `policy.allowedPlainNumbers[${i}]`));
  }
  return policy;
}

function readJson(file: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new ConfigError(`Cannot read file: ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}

function inFile<T>(file: string, load: () => T): T {
  try {
    return load();
  } catch (error) {
    if (error instanceof ConfigError && !error.message.includes(file)) throw new ConfigError(`${file}: ${error.message}`);
    throw error;
  }
}

export function loadCatalog(file: string): Product[] {
  return inFile(file, () => parseCatalog(readJson(file)));
}

export function loadPolicy(file: string): Partial<Policy> {
  return inFile(file, () => parsePolicy(readJson(file)));
}
