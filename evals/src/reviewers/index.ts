import type { DiskCache } from '../cache.js';
import { providerFromEnv, type ProviderName } from '../llm/provider.js';
import type { Reviewer } from '../types.js';
import { BaselineReviewer } from './baseline.js';
import { DiffwiseHttpReviewer } from './diffwise.js';
import { HeuristicMockReviewer, SilentReviewer } from './mock.js';

export const REVIEWER_NAMES = ['baseline', 'diffwise', 'mock', 'silent'] as const;
export type ReviewerName = (typeof REVIEWER_NAMES)[number];

export interface ReviewerChoice {
  reviewer: Reviewer;
  /** Human-readable note when we had to fall back (e.g. no API key -> mock). */
  fallbackNote?: string;
}

export function createReviewer(name: ReviewerName, opts: { provider?: ProviderName; model?: string; chunkCache?: DiskCache } = {}): ReviewerChoice {
  switch (name) {
    case 'baseline': {
      const llm = providerFromEnv(opts.provider ?? (process.env.EVALS_REVIEWER_PROVIDER as ProviderName) ?? 'gemini', opts.model ?? process.env.EVALS_REVIEWER_MODEL);
      if (!llm) return { reviewer: new HeuristicMockReviewer(), fallbackNote: 'No GEMINI_API_KEY/GROQ_API_KEY: baseline replaced by mock-heuristic.' };
      return { reviewer: new BaselineReviewer(llm, { chunkCache: opts.chunkCache }) };
    }
    case 'diffwise': {
      const url = process.env.DIFFWISE_REVIEW_URL;
      if (!url) return { reviewer: new SilentReviewer(), fallbackNote: 'DIFFWISE_REVIEW_URL not set: diffwise replaced by mock-silent.' };
      return { reviewer: new DiffwiseHttpReviewer(url) };
    }
    case 'mock':
      return { reviewer: new HeuristicMockReviewer() };
    case 'silent':
      return { reviewer: new SilentReviewer() };
  }
}
