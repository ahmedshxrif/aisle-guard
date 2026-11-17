// The model is behind a one-method interface, so the assistant can be tested without a network
// call and so the guardrails never depend on which model wrote the reply.

import Anthropic from "@anthropic-ai/sdk";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  system: string;
  messages: Turn[];
}

export interface ModelReply {
  text: string;
  /** What the call really cost, when the model can report it. Used to settle the budget. */
  costUsd?: number;
}

export interface Model {
  reply(request: ModelRequest): Promise<ModelReply>;
}

/** Price per million tokens, input and output. Unknown models fall back to the most expensive row. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** The cost of one call from its token counts. Cached reads are cheap; writing the cache costs a little more. */
export function costOf(model: string, usage: Usage): number {
  const [input, output] = PRICES[model] ?? [4, 20];
  const tokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (tokens * input + usage.output_tokens * output) / 1_000_000;
}

export class ModelDeclined extends Error {
  constructor() {
    super("The model declined to answer");
    this.name = "ModelDeclined";
  }
}

export interface AnthropicModelOptions {
  /** Defaults to a small, fast model: a shopper is waiting. Override with AISLE_MODEL. */
  model?: string;
  client?: Anthropic;
}

/** A model backed by the Claude API. Needs ANTHROPIC_API_KEY, or a logged-in `ant` profile. */
export function anthropicModel(options: AnthropicModelOptions = {}): Model {
  const model = options.model ?? process.env.AISLE_MODEL ?? "claude-haiku-4-5";
  // A shopper will not wait: fail fast and let the assistant fall back to a safe answer.
  const client = options.client ?? new Anthropic({ timeout: 15_000, maxRetries: 1 });
  return {
    async reply({ system, messages }) {
      const response = await client.messages.create({
        model,
        max_tokens: 300,
        // The system prompt holds the whole catalogue and never changes between shoppers,
        // so it is cached: later calls read it at a fraction of the price.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
      });
      if (response.stop_reason === "refusal") throw new ModelDeclined();
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ")
        .trim();
      return { text, costUsd: costOf(model, response.usage) };
    },
  };
}

/** A scripted stand-in for the model, used by the tests and by the offline chat. */
export function scriptedModel(script: (request: ModelRequest) => string, costUsd?: number): Model {
  return { reply: async (request) => ({ text: script(request), costUsd }) };
}
