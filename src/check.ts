// The logic behind `aisle-guard check`, kept apart from the CLI so tests can call it directly.

import { checkReply, type Verdict } from "./guardrails.ts";
import type { Product } from "./catalog.ts";

export interface CheckArgs {
  product?: string;
  file?: string;
  json: boolean;
  reply: string;
}

export function parseCheckArgs(args: string[]): CheckArgs {
  const parsed: CheckArgs = { json: false, reply: "" };
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") parsed.json = true;
    else if (arg === "--product") parsed.product = args[++i] ?? "";
    else if (arg === "--file") parsed.file = args[++i] ?? "";
    else words.push(arg);
  }
  parsed.reply = words.join(" ");
  return parsed;
}

// One reply per line. Blank lines are skipped, and so is a stray \r from a Windows file.
export function splitReplies(text: string): string[] {
  return text.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line.trim() !== "");
}

export interface CheckResult {
  output: string;
  blocked: boolean;
}

// Shape documented in the README: one object per reply, one per line.
export function formatJson(replies: string[], verdicts: Verdict[]): string {
  return replies
    .map((reply, i) => JSON.stringify({ reply, ok: verdicts[i]!.ok, violations: verdicts[i]!.violations }))
    .join("\n");
}

function formatText(replies: string[], verdicts: Verdict[]): string {
  const lines: string[] = [];
  const several = replies.length > 1;
  verdicts.forEach((verdict, i) => {
    const label = several ? ` (line ${i + 1}) ${replies[i]}` : "";
    if (verdict.ok) {
      lines.push(several ? `OK${label}` : "OK: this reply can be spoken.");
    } else {
      lines.push(several ? `BLOCKED${label}` : "BLOCKED:");
      for (const v of verdict.violations) lines.push(`  [${v.rule}] "${v.excerpt}" - ${v.detail}`);
    }
  });
  return lines.join("\n");
}

export function checkReplies(replies: string[], products: Product[], json: boolean): CheckResult {
  const verdicts = replies.map((reply) => checkReply(reply, products));
  return {
    output: json ? formatJson(replies, verdicts) : formatText(replies, verdicts),
    blocked: verdicts.some((v) => !v.ok),
  };
}
