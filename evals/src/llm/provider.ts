/**
 * Tiny LLM abstraction. Every provider takes a system + user prompt and returns text plus usage.
 * Keeping this small means swapping Gemini <-> Groq (or adding another free provider) is one file.
 */
import { estimateCostUsd } from './pricing.js';

export interface LlmRequest {
  system: string;
  prompt: string;
  /** Ask the provider for a JSON object response. */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  model: string;
}

export interface LlmProvider {
  readonly name: 'gemini' | 'groq' | 'mock';
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    /** Server-requested wait (Retry-After), if any. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry transient failures (429/5xx/network) with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 5, baseMs = 2000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = !(e instanceof LlmError) || e.retryable;
      if (!retryable || i === attempts - 1) break;
      const hinted = e instanceof LlmError && e.retryAfterMs ? Math.min(e.retryAfterMs, 90_000) : 0;
      await sleep(Math.max(baseMs * 2 ** i, hinted));
    }
  }
  throw last;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new LlmError(`network error: ${(e as Error).message}`, undefined, true);
  }
  const text = await res.text();
  if (!res.ok) {
    // Never echo request headers/keys; the body from the provider is safe to show.
    const ra = Number(res.headers.get('retry-after'));
    throw new LlmError(
      `HTTP ${res.status}: ${text.slice(0, 300)}`,
      res.status,
      res.status === 429 || res.status >= 500,
      Number.isFinite(ra) && ra > 0 ? ra * 1000 + 500 : undefined,
    );
  }
  return JSON.parse(text) as unknown;
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  constructor(
    private readonly apiKey: string,
    readonly model = 'gemini-3.5-flash',
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const data = (await withRetry(() =>
      postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
          generationConfig: {
            temperature: req.temperature ?? 0,
            // Thinking tokens count toward this limit on Gemini, so never go below 8192.
            maxOutputTokens: Math.max(req.maxOutputTokens ?? 0, 8192),
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        },
        { 'x-goog-api-key': this.apiKey },
      ),
    )) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    // Thinking tokens are billed as output tokens.
    const outputTokens = (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0);
    return {
      text,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      costUsd: estimateCostUsd(this.model, inputTokens, outputTokens),
      model: this.model,
    };
  }
}

export class GroqProvider implements LlmProvider {
  readonly name = 'groq' as const;
  constructor(
    private readonly apiKey: string,
    readonly model = 'openai/gpt-oss-120b',
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const data = (await withRetry(() =>
      postJson(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: this.model,
          temperature: req.temperature ?? 0,
          // Groq's TPM limiter reserves max_completion_tokens up front, so keep it tight.
          max_completion_tokens: req.maxOutputTokens ?? 2048,
          ...(this.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        },
        { authorization: `Bearer ${this.apiKey}` },
      ),
    )) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      costUsd: estimateCostUsd(this.model, inputTokens, outputTokens),
      model: this.model,
    };
  }
}

/** Deterministic offline provider: returns a canned response computed from the prompt. */
export class MockProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';
  constructor(private readonly respond: (req: LlmRequest) => string = () => '{}') {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const text = this.respond(req);
    return {
      text,
      inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
      latencyMs: 0,
      costUsd: 0,
      model: this.model,
    };
  }
}

export type ProviderName = 'gemini' | 'groq' | 'mock';

/**
 * Build a provider from env. If the requested provider has no key, fall back to the other
 * real provider, then to `null` (callers then switch to their mock mode).
 */
export function providerFromEnv(preferred: ProviderName, model?: string): LlmProvider | null {
  const gemini = process.env.GEMINI_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  if (preferred === 'mock') return null;
  if (preferred === 'gemini' && gemini) return new GeminiProvider(gemini, model);
  if (preferred === 'groq' && groq) return new GroqProvider(groq, model);
  if (gemini) return new GeminiProvider(gemini);
  if (groq) return new GroqProvider(groq);
  return null;
}

/** Pull the first JSON object/array out of a model response (handles ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error(`no JSON found in model output: ${text.slice(0, 200)}`);
  }
}

/** Try providers in order; the first success wins. Used where availability matters more than model identity. */
export class FallbackProvider implements LlmProvider {
  readonly name: LlmProvider['name'];
  readonly model: string;
  constructor(private readonly chain: LlmProvider[]) {
    if (chain.length === 0) throw new Error('FallbackProvider needs at least one provider');
    this.name = chain[0]!.name;
    this.model = chain.map((p) => p.model).join('|');
  }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    let last: unknown;
    for (const p of this.chain) {
      try {
        return await p.complete(req);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
}

/** All configured real providers, preferred first (for fallback chains). */
export function providerChainFromEnv(preferred: ProviderName): LlmProvider | null {
  const all: LlmProvider[] = [];
  if (process.env.GEMINI_API_KEY) all.push(new GeminiProvider(process.env.GEMINI_API_KEY));
  if (process.env.GROQ_API_KEY) all.push(new GroqProvider(process.env.GROQ_API_KEY));
  all.sort((a, b) => Number(b.name === preferred) - Number(a.name === preferred));
  if (all.length === 0) return null;
  return all.length === 1 ? all[0]! : new FallbackProvider(all);
}
