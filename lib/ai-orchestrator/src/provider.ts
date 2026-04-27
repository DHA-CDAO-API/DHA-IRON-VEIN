import { openai } from "@workspace/integrations-openai-ai-server";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  type AIRequest,
  type StreamChunk,
} from "./types";

export function resolveModel(provider: "openai" | "anthropic", requested?: string): string {
  if (requested && requested.trim().length > 0) return requested;
  return provider === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL;
}

export async function* streamChat(req: AIRequest): AsyncGenerator<StreamChunk> {
  try {
    if (req.provider === "openai") {
      yield* streamOpenAI(req);
    } else {
      yield* streamAnthropic(req);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: "error", value: msg };
  }
  yield { type: "done" };
}

async function* streamOpenAI(req: AIRequest): AsyncGenerator<StreamChunk> {
  const stream = await openai.chat.completions.create({
    model: req.model,
    stream: true,
    messages: [
      { role: "system", content: req.system },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: req.maxOutputTokens ?? 1024,
  });
  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      yield { type: "token", value: delta };
    }
  }
}

async function* streamAnthropic(req: AIRequest): AsyncGenerator<StreamChunk> {
  const stream = anthropic.messages.stream({
    model: req.model,
    system: req.system,
    max_tokens: req.maxOutputTokens ?? 1024,
    messages: req.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  });
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta" &&
      event.delta.text.length > 0
    ) {
      yield { type: "token", value: event.delta.text };
    }
  }
}

export async function completeChat(req: AIRequest): Promise<string> {
  let out = "";
  for await (const chunk of streamChat(req)) {
    if (chunk.type === "token") out += chunk.value;
  }
  return out;
}
