// The assistant: decide what the server can answer itself, ask the model for the rest,
// and never let a reply through that breaks a rule.

import { catalog as defaultCatalog, spec, type Product } from "./catalog.ts";
import { BudgetGuard } from "./budget.ts";
import { gapFromQuestion, willItFit } from "./fit.ts";
import { checkReply, normalise, type Policy, type Violation } from "./guardrails.ts";
import type { Model, Turn } from "./model.ts";

export interface Session {
  history: Turn[];
  /** The product the conversation is currently about. */
  focus?: Product;
}

export interface Answer {
  text: string;
  /** Where the words came from: a server rule, the model, the model's second try, or the safe fallback. */
  source: "rule" | "model" | "retry" | "fallback";
  /** What the guardrails caught along the way, even when the final reply is clean. */
  caught: Violation[];
  focus?: Product;
}

export interface AssistantOptions {
  model: Model;
  products?: Product[];
  policy?: Partial<Policy>;
  budget?: BudgetGuard;
  /** A rough cost per model call, used to reserve budget before calling. */
  costPerCallUsd?: number;
}

/** How many past turns are sent with each question. */
const MAX_HISTORY_TURNS = 12;
/** A spoken question is short. Anything longer is not sent to the model, so one request cannot run up the bill. */
const MAX_QUESTION_CHARS = 400;

const PRICE_QUESTION = /\b(price|cost|how much|expensive|cheap|discount|offer|deal|instal?ments?|pay)\b/i;
const FIT_QUESTION = /\b(fit|space|gap|wide|width|narrow)\b/i;

const CATEGORY_WORDS: Array<[RegExp, Product["category"]]> = [
  [/\b(fridge|refrigerator|freezer)\b/i, "refrigerator"],
  [/\b(washer|washing|laundry)\b/i, "washer"],
  [/\b(dryer)\b/i, "dryer"],
];

function pickFocus(question: string, products: Product[], current?: Product): Product | undefined {
  const byName = products.find((p) => question.toLowerCase().includes(p.name.toLowerCase()));
  if (byName) return byName;
  for (const [pattern, category] of CATEGORY_WORDS) {
    if (pattern.test(question) && current?.category !== category) return products.find((p) => p.category === category);
  }
  return current;
}

export function systemPrompt(products: Product[]): string {
  const sheets = products
    .map((p) => `${p.name} (id ${p.id})\n${p.specs.map((s) => `- ${s.label}: ${s.value} ${s.unit}`).join("\n")}\n- Features: ${p.features.join(", ")}`)
    .join("\n\n");
  return [
    "You are a shopping assistant in an appliance store. You speak out loud to a shopper standing in front of the product.",
    "Answer first, in one or two short sentences. Ask at most one plain question when you need to know more.",
    "Only state facts from the spec sheets below. If a fact is not there, say you are not sure and offer to get a member of staff.",
    "Never mention prices or discounts, and never name another brand.",
    "",
    "Spec sheets:",
    sheets,
  ].join("\n");
}

/** What the assistant says when the model cannot be trusted or cannot be reached: facts only, straight from the sheet. */
export function fallbackReply(product: Product | undefined): string {
  if (!product) return "I'm not sure about that one. Let me get a member of staff to help you.";
  const capacity = spec(product, "Capacity");
  const width = spec(product, "Width");
  const facts = [capacity && `it holds ${capacity.value} ${capacity.unit}`, width && `it is ${width.value} ${width.unit} wide`].filter(Boolean);
  return `Here is what I can tell you about the ${product.name}: ${facts.join(" and ")}. A member of staff can help with anything else.`;
}

export async function answer(rawQuestion: string, session: Session, options: AssistantOptions): Promise<Answer> {
  const question = normalise(rawQuestion).trim();
  const products = options.products ?? defaultCatalog;
  // An over-long question is turned away before it is stored, so it can never ride along
  // in the history of a later, paid call.
  if (question.length > MAX_QUESTION_CHARS) {
    return { text: "That was a lot to take in. Could you ask me one thing at a time?", source: "rule", caught: [], focus: session.focus };
  }
  const finish = (text: string, source: Answer["source"], caught: Violation[] = []): Answer => {
    session.history.push({ role: "user", content: question }, { role: "assistant", content: text });
    return { text, source, caught, focus };
  };

  const focus = pickFocus(question, products, session.focus);
  session.focus = focus;

  // 1. Things the server answers itself, with no model call at all.
  if (PRICE_QUESTION.test(question)) {
    return finish("Prices differ by store, so the team at the counter will help with that. I can tell you anything else about it.", "rule");
  }
  const gap = FIT_QUESTION.test(question) ? gapFromQuestion(question) : undefined;
  if (gap !== undefined && focus) {
    const fit = willItFit(focus, gap);
    return finish(
      fit.fits
        ? `Yes, it fits. It is ${fit.widthCm} cm wide, so a ${gap} cm space leaves ${fit.spareCm} cm to spare.`
        : `No, it is ${fit.widthCm} cm wide, which is too tight for a ${gap} cm space.`,
      "rule",
    );
  }

  // 2. Everything else goes to the model. Every call is paid for separately: budget is reserved
  //    before it and settled after it, so the retry can never spend money that was not set aside.
  const cost = options.costPerCallUsd ?? 0.002;
  const ask = async (messages: Turn[]): Promise<string | null> => {
    const reservation = options.budget?.tryReserve(cost);
    if (options.budget && !reservation) return null; // out of budget
    let spent = cost; // if the call fails we cannot know what it cost, so the estimate stands
    try {
      const reply = await options.model.reply({ system, messages });
      spent = reply.costUsd ?? cost;
      return reply.text;
    } finally {
      if (reservation) options.budget!.settle(reservation, spent);
    }
  };

  const caught: Violation[] = [];
  const context = focus ? [focus] : products;
  const system = systemPrompt(products);
  // Only the recent turns are sent, so a long conversation cannot grow the cost of every call.
  const messages: Turn[] = [...session.history.slice(-MAX_HISTORY_TURNS), { role: "user", content: question }];
  try {
    const first = await ask(messages);
    if (first === null) return finish(fallbackReply(focus), "fallback");
    const verdict = checkReply(first, context, options.policy);
    if (verdict.ok) return finish(first, "model");
    caught.push(...verdict.violations);

    // 3. One second chance, telling the model exactly which rules it broke.
    const correction = `Your reply broke these rules, so it was not spoken:\n${verdict.violations.map((v) => `- ${v.detail}`).join("\n")}\nAnswer the shopper again and follow every rule.`;
    const second = await ask([...messages, { role: "assistant", content: first }, { role: "user", content: correction }]);
    if (second === null) return finish(fallbackReply(focus), "fallback", caught);
    const recheck = checkReply(second, context, options.policy);
    if (recheck.ok) return finish(second, "retry", caught);
    caught.push(...recheck.violations);
    return finish(fallbackReply(focus), "fallback", caught);
  } catch {
    // The model timed out, errored or declined. The shopper still gets a true answer.
    return finish(fallbackReply(focus), "fallback", caught);
  }
}
