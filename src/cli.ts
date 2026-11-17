#!/usr/bin/env node
// aisle-guard check "<reply>" [--product <id>] [--file <path>] [--json]   check replies against the rules
// aisle-guard chat                               talk to the assistant in the terminal

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit, env } from "node:process";
import { checkReplies, parseCheckArgs, splitReplies } from "./check.ts";
import { answer, anthropicModel, catalog, checkReply, findProduct, scriptedModel, type Session } from "./index.ts";

const [command, ...rest] = argv.slice(2);

if (command === "check") {
  const args = parseCheckArgs(rest);
  const product = args.product !== undefined ? findProduct(args.product) : undefined;
  if (args.product !== undefined && !product) {
    console.error(`Unknown product. Try one of: ${catalog.map((p) => p.id).join(", ")}`);
    exit(2);
  }
  let replies: string[];
  if (args.file !== undefined) {
    try {
      replies = splitReplies(readFileSync(args.file, "utf8"));
    } catch {
      console.error(`Cannot read file: ${args.file}`);
      exit(2);
    }
  } else if (args.reply) {
    replies = [args.reply];
  } else if (!stdin.isTTY) {
    replies = splitReplies(readFileSync(0, "utf8"));
  } else {
    replies = [];
  }
  if (replies.length === 0) {
    console.error('Usage: aisle-guard check "<reply>" [--product <id>] [--file <path>] [--json]\n(with no reply, replies are read from standard input, one per line)');
    exit(2);
  }
  const result = checkReplies(replies, product ? [product] : catalog, args.json);
  console.log(result.output);
  if (result.blocked) exit(1);
} else if (command === "chat") {
  const live = Boolean(env.ANTHROPIC_API_KEY);
  // Without a key the chat still works: a scripted model plays the part, including one bad reply
  // so you can watch the guardrails catch it.
  const model = live
    ? anthropicModel()
    : scriptedModel(({ messages }) => {
        const last = messages.at(-1)!.content.toLowerCase();
        if (last.includes("broke these rules")) return "It holds 650 l and runs at 39 db, so it suits a big family and a quiet kitchen.";
        if (last.includes("quiet")) return "It never breaks and runs at 20 db, quieter than the Frostline.";
        return "It holds 650 l, enough for a full weekly shop. How many of you are at home?";
      });
  console.log(live ? "Live model. Ask about a fridge or a washer. Ctrl+C to leave." : 'No API key found, so a scripted model is answering. Try "is it quiet?" to watch a reply get caught.');
  const session: Session = { history: [] };
  const lines = createInterface({ input: stdin, output: stdout });
  lines.on("close", () => exit(0));
  for (;;) {
    const question = (await lines.question("\nyou > ")).trim();
    if (!question) continue;
    const result = await answer(question, session, { model });
    for (const v of result.caught) console.log(`  (caught: ${v.rule} "${v.excerpt}")`);
    console.log(`assistant [${result.source}] > ${result.text}`);
  }
} else {
  console.log('aisle-guard\n\n  check "<reply>" [--product <id>] [--file <path>] [--json]\n                                     check replies against the rules\n  chat                               talk to the assistant in the terminal');
}
