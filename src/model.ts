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

export interface Model {
  reply(request: ModelRequest): Promise<string>;
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
      return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ")
        .trim();
    },
  };
}

/** A scripted stand-in for the model, used by the tests and by the offline chat. */
export function scriptedModel(script: (request: ModelRequest) => string): Model {
  return { reply: async (request) => script(request) };
}
