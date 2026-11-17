// The guardrails. Every reply the model writes passes through checkReply before a shopper hears it.
// The rules are deliberately plain code, not another model call: they are fast, free, and they
// behave the same way every time, which is what you want from the last line of defence.

import type { Product, Unit } from "./catalog.ts";

export type Rule = "price" | "competitor" | "unsupported-number" | "absolute-claim" | "too-long" | "unreadable";

export interface Violation {
  rule: Rule;
  /** The words in the reply that broke the rule. */
  excerpt: string;
  /** A plain explanation, also used to tell the model what to fix. */
  detail: string;
}

export interface Policy {
  /** Brand names the assistant must never say. */
  competitors: string[];
  /** Spoken replies should be short. */
  maxSentences: number;
  /** Numbers that are allowed even though they are not on a spec sheet, such as a fit calculation. */
  allowedNumbers: Array<{ value: number; unit: Unit }>;
  /** Plain numbers with no unit that may be said, such as the size of a household the shopper mentioned. */
  allowedPlainNumbers: number[];
}

export const defaultPolicy: Policy = {
  competitors: ["Frostline", "Coolmax", "Nordwash", "Brand X"],
  maxSentences: 3,
  allowedNumbers: [],
  allowedPlainNumbers: [],
};

export interface Verdict {
  ok: boolean;
  violations: Violation[];
}

const MONEY_WORDS = "aed|usd|sar|qar|kwd|bhd|omr|dhs?|dirhams?|dollars?|riyals?|dinars?|bucks";
const PRICE_PATTERNS: RegExp[] = [
  new RegExp(`(?:${MONEY_WORDS}|[$€£])\\s*\\d[\\d,.]*`, "i"),
  new RegExp(`\\d[\\d,.]*\\s*(?:${MONEY_WORDS})\\b`, "i"),
  // A money word with no digits near it is still a price: "two thousand dirhams".
  new RegExp(`\\b(?:${MONEY_WORDS})\\b|[$€£]`, "i"),
  /\b(?:costs?|priced? (?:at|is)|price is|sells? for)\s+\d[\d,.]*/i,
  /\b\d{1,2}\s?% off\b/i,
  /\b(?:on sale|discount(?:ed)?|cheapest|cheaper than|special offer)\b/i,
];

const ABSOLUTE_CLAIMS =
  /\b(never (?:breaks?|fails?|leaks?|needs)|lasts? forever|guaranteed?|unbreakable|lifetime|best (?:in the world|on the market|you can buy)|100\s?% (?:safe|reliable|quiet))\b/i;

// How a unit can be written in a sentence, mapped to the unit used on the spec sheet.
const UNIT_WORDS: Array<[RegExp, Unit]> = [
  [/^(?:l|litres?|liters?)$/i, "l"],
  [/^(?:kg|kilos?|kilograms?)$/i, "kg"],
  [/^(?:cm|centimetres?|centimeters?)$/i, "cm"],
  [/^(?:db|decibels?)$/i, "db"],
  [/^(?:kwh)$/i, "kwh"],
  [/^(?:years?|yrs?)$/i, "year"],
  [/^(?:minutes?|mins?)$/i, "minute"],
  [/^(?:stars?)$/i, "star"],
  [/^(?:inch(?:es)?|in)$/i, "inch"],
  [/^(?:w|watts?)$/i, "w"],
];
const UNITS = "litres?|liters?|l|kilograms?|kilos?|kg|centimetres?|centimeters?|cm|decibels?|db|kwh|years?|yrs?|minutes?|mins?|stars?|inch(?:es)?|watts?|w";
// A whole number is read in one piece, including thousands separators ("1,650" or "1 650"),
// and never from the middle of a longer one. Otherwise "1 650 litres" would be read as 650.
const QUANTITY = new RegExp(`(?<![\\d.,])(\\d{1,3}(?:[ ,]\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)[\\s-]*(${UNITS})\\b`, "gi");
// A figure spelled out ("twenty decibels") cannot be checked against the sheet, so it is not allowed.
const NUMBER_WORD = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half|dozen";
const SPELLED_QUANTITY = new RegExp(`\\b(?:${NUMBER_WORD})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMBER_WORD}))*[\\s-]+(?:${UNITS})\\b`, "i");

/**
 * Put text into the one form the rules can read: compatibility characters folded (full-width
 * digits, ligatures), invisible characters removed, and Arabic-Indic digits turned into 0-9.
 * Without this, "٢٬١٩٩" or a zero-width space inside "dir\u200bhams" would walk past every rule.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g, "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u066B\u066C]/g, ",");
}

function toUnit(word: string): Unit | undefined {
  return UNIT_WORDS.find(([pattern]) => pattern.test(word))?.[1];
}

/** Every "number + unit" in a piece of text, for example 650 litres or 39 dB. */
export function quantities(text: string): Array<{ value: number; unit: Unit; excerpt: string; index: number }> {
  const found: Array<{ value: number; unit: Unit; excerpt: string; index: number }> = [];
  for (const match of text.matchAll(QUANTITY)) {
    const unit = toUnit(match[2]!);
    const raw = match[1]!;
    const grouped = /^\d{1,3}(?:[ ,]\d{3})+/.test(raw);
    const value = Number(grouped ? raw.replace(/[ ,]/g, "") : raw.replace(",", "."));
    if (unit) found.push({ value, unit, excerpt: match[0], index: match.index });
  }
  return found;
}

function countSentences(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((part) => /\w/.test(part)).length;
}

/**
 * Check one reply against the rules.
 * `products` are the products the reply is allowed to talk about: their spec sheets are the only
 * numbers the reply may quote.
 */
export function checkReply(rawReply: string, products: Product[], policy: Partial<Policy> = {}): Verdict {
  const rules: Policy = { ...defaultPolicy, ...policy };
  const violations: Violation[] = [];
  const reply = normalise(rawReply);

  // The rules read English. Anything else fails closed: it is blocked, not waved through.
  const foreign = reply.match(/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+/u);
  if (foreign) violations.push({ rule: "unreadable", excerpt: foreign[0], detail: "Reply in English only, so the reply can be checked." });

  for (const pattern of PRICE_PATTERNS) {
    const hit = reply.match(pattern);
    if (hit) {
      violations.push({ rule: "price", excerpt: hit[0], detail: "Never mention a price or a discount. Prices differ by store, so send price questions to the staff." });
      break;
    }
  }

  for (const name of rules.competitors) {
    const hit = reply.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
    if (hit) violations.push({ rule: "competitor", excerpt: hit[0], detail: "Never name another brand. Talk about what this product does well instead." });
  }

  const allowed = [...products.flatMap((p) => p.specs), ...rules.allowedNumbers];
  const found = quantities(reply);
  for (const q of found) {
    const backed = allowed.some((s) => s.unit === q.unit && Math.abs(s.value - q.value) < 0.05);
    if (!backed) violations.push({ rule: "unsupported-number", excerpt: q.excerpt, detail: `"${q.excerpt}" is not on the spec sheet. Only quote figures that are.` });
  }
  // Every other number fails closed. A figure with an unknown unit ("30%", "2 m", "6 months")
  // or no unit at all cannot be checked against the sheet, so it may not be said.
  let rest = reply;
  for (const q of [...found].reverse()) rest = rest.slice(0, q.index) + " ".repeat(q.excerpt.length) + rest.slice(q.index + q.excerpt.length);
  const pricedAlready = violations.some((v) => v.rule === "price"); // the price rule has already named that number
  for (const bare of pricedAlready ? [] : rest.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const value = Number(bare[0].replace(/,/g, ""));
    if (rules.allowedPlainNumbers.includes(value)) continue;
    violations.push({ rule: "unsupported-number", excerpt: bare[0], detail: `"${bare[0]}" cannot be checked against the spec sheet. Leave it out.` });
    break;
  }

  const spelled = reply.match(SPELLED_QUANTITY);
  if (spelled) violations.push({ rule: "unsupported-number", excerpt: spelled[0], detail: `"${spelled[0]}" cannot be checked. Write figures as digits, and only ones from the spec sheet.` });

  const claim = reply.match(ABSOLUTE_CLAIMS);
  if (claim) violations.push({ rule: "absolute-claim", excerpt: claim[0], detail: "Do not promise things the spec sheet cannot back, such as 'never breaks' or 'lifetime'." });

  if (countSentences(reply) > rules.maxSentences) {
    violations.push({ rule: "too-long", excerpt: `${countSentences(reply)} sentences`, detail: `Keep spoken replies to ${rules.maxSentences} sentences or fewer.` });
  }

  return { ok: violations.length === 0, violations };
}
