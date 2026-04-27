export type AIProvider = "openai" | "anthropic";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamChunk =
  | { type: "token"; value: string }
  | { type: "citation"; refType: string; refId: string; label: string }
  | { type: "done"; value?: string }
  | { type: "error"; value: string };

export type AIRequest = {
  provider: AIProvider;
  model: string;
  system: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
};
