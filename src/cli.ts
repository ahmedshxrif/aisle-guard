#!/usr/bin/env node
// aisle-guard check "<reply>" [--product <id>]   check one reply against the rules
// aisle-guard chat                               talk to the assistant in the terminal

import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit, env } from "node:process";
import { answer, anthropicModel, catalog, checkReply, findProduct, scriptedModel, type Session } from "./index.ts";

const [command, ...rest] = argv.slice(2);

if (command === "check") {
  const flag = rest.indexOf("--product");
  const product = flag >= 0 ? findProduct(rest[flag + 1] ?? "") : undefined;
  if (flag >= 0 && !product) {
    console.error(`Unknown product. Try one of: ${catalog.map((p) => p.id).join(", ")}`);
    exit(2);
  }
  const reply = rest.filter((_, i) => flag < 0 || (i !== flag && i !== flag + 1)).join(" ");
  if (!reply) {
    console.error('Usage: aisle-guard check "<reply>" [--product <id>]');
    exit(2);
  }
  const verdict = checkReply(reply, product ? [product] : catalog);
  if (verdict.ok) {
    console.log("OK: this reply can be spoken.");
  } else {
    console.log("BLOCKED:");
    for (const v of verdict.violations) console.log(`  [${v.rule}] "${v.excerpt}" - ${v.detail}`);
    exit(1);
  }
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
  console.log('aisle-guard\n\n  check "<reply>" [--product <id>]   check one reply against the rules\n  chat                               talk to the assistant in the terminal');
}
