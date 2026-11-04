/**
 * List-price table (USD per 1M tokens) used to report a *cost-equivalent* per review.
 * The harness runs on free tiers, so the real bill is $0; these numbers make reviewers comparable
 * and show what a paid deployment would cost. Verify against the provider pricing pages before
 * quoting them: https://ai.google.dev/gemini-api/docs/pricing and https://groq.com/pricing
 * Values marked `assumed` were not verifiable when this file was written.
 */
export interface Price {
  inputPerM: number;
  outputPerM: number;
  assumed?: boolean;
}

export const PRICES: Record<string, Price> = {
  'gemini-3.5-flash': { inputPerM: 0.3, outputPerM: 2.5, assumed: true },
  'gemini-3.1-flash-lite': { inputPerM: 0.1, outputPerM: 0.4, assumed: true },
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5 },
  'openai/gpt-oss-120b': { inputPerM: 0.15, outputPerM: 0.6, assumed: true },
  'openai/gpt-oss-20b': { inputPerM: 0.075, outputPerM: 0.3, assumed: true },
  mock: { inputPerM: 0, outputPerM: 0 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1_000_000;
}
