import Anthropic from "@anthropic-ai/sdk";
import config from "../config";

/**
 * One narrow interface over whichever model provider is configured, so a
 * change of provider is an env var rather than a rewrite. Everything above
 * this file talks in prompts and strings and never imports a vendor SDK.
 */
export type AiMessage = { role: "user" | "assistant"; content: string };

export type AiRequest = {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  /** Higher for conversational variety, lower for classification. */
  temperature?: number;
};

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "No AI provider is configured. Set AI_PROVIDER and the matching API key."
    );
    this.name = "AiNotConfiguredError";
  }
}

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

const DEFAULT_MAX_TOKENS = 1024;

/** OpenAI-compatible providers: DeepSeek, OpenAI, Together, Groq, and others. */
const callOpenAiCompatible = async (
  req: AiRequest,
  opts: { baseUrl: string; apiKey: string; model: string }
): Promise<string> => {
  const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: req.temperature ?? 0.8,
      messages: [
        { role: "system", content: req.system },
        ...req.messages,
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiRequestError(
      `${opts.model} request failed: ${res.status} ${body.slice(0, 300)}`,
      res.status
    );
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AiRequestError("The model returned an empty response.");
  return text;
};

let anthropicClient: Anthropic | null = null;

const callAnthropic = async (
  req: AiRequest,
  opts: { apiKey: string; model: string }
): Promise<string> => {
  anthropicClient ??= new Anthropic({ apiKey: opts.apiKey });

  const response = await anthropicClient.messages.create({
    model: opts.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: req.system,
    messages: req.messages,
  });

  // A safety refusal comes back as a 200 with no usable content, so check
  // before reading the blocks.
  if (response.stop_reason === "refusal") {
    throw new AiRequestError("The model declined to answer this prompt.");
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("")
    .trim();

  if (!text) throw new AiRequestError("The model returned an empty response.");
  return text;
};

export const isAiConfigured = (): boolean => {
  const { provider, apiKey } = config.ai;
  return Boolean(provider && apiKey);
};

/**
 * Sends one request to the configured provider.
 *
 * Throws [AiNotConfiguredError] when no key is set, so callers can skip
 * quietly rather than crash a scheduled job on a server without AI enabled.
 */
export const askAi = async (req: AiRequest): Promise<string> => {
  const { provider, apiKey, model, baseUrl } = config.ai;
  if (!apiKey) throw new AiNotConfiguredError();

  switch (provider) {
    case "anthropic":
      return callAnthropic(req, { apiKey, model });
    // DeepSeek and every other OpenAI-shaped API share one code path.
    case "deepseek":
    case "openai":
    case "openai-compatible":
      return callOpenAiCompatible(req, { baseUrl, apiKey, model });
    default:
      throw new AiNotConfiguredError();
  }
};

/**
 * Asks for JSON and parses it. Models like to wrap JSON in prose or a fenced
 * block even when told not to, so the fence is stripped before parsing.
 */
export const askAiForJson = async <T>(req: AiRequest): Promise<T> => {
  const raw = await askAi(req);
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  const slice =
    start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  try {
    return JSON.parse(slice) as T;
  } catch {
    throw new AiRequestError(
      `Expected JSON but got: ${raw.slice(0, 200)}`
    );
  }
};
