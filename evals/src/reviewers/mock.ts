/**
 * Offline reviewers for running the whole pipeline with no API keys.
 * - `mock-heuristic`: flags a few classic JS smells on added lines (==, missing await on then-less
 *   promises, `||` defaults on numbers, ...). Deterministic, cheap, and bad — which is the point:
 *   it gives the scoreboard a non-trivial row to render.
 * - `mock-silent`: never comments. Floor for recall, ceiling for "quietness".
 */
import { parseDiff } from '../diff.js';
import type { ReviewComment, ReviewInput, ReviewResult, Reviewer } from '../types.js';

const RULES: { re: RegExp; body: string; severity: ReviewComment['severity'] }[] = [
  { re: /[^=!]==[^=]/, body: 'Loose equality (==) can coerce types unexpectedly; use ===.', severity: 'minor' },
  { re: /\|\|\s*(0|''|""|false)\b/, body: '`||` replaces valid falsy values (0, "", false); consider `??`.', severity: 'major' },
  { re: /\.forEach\(\s*async/, body: 'async callback in forEach is not awaited; errors and ordering are lost.', severity: 'major' },
  { re: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/, body: 'Empty catch block swallows errors.', severity: 'minor' },
  { re: /\bparseInt\([^,()]+\)/, body: 'parseInt without a radix.', severity: 'nit' },
  { re: /!\w+\.length\b/, body: 'Check whether an empty array/string is handled correctly here.', severity: 'minor' },
  { re: /\bdelete\s+\w+\[/, body: 'Mutating with delete on a shared object may affect other references.', severity: 'minor' },
];

export class HeuristicMockReviewer implements Reviewer {
  readonly id = 'mock-heuristic-v1';
  async review(input: ReviewInput): Promise<ReviewResult> {
    const comments: ReviewComment[] = [];
    for (const f of parseDiff(input.diff)) {
      if (!f.newPath) continue;
      for (const h of f.hunks)
        for (const l of h.lines) {
          if (l.type !== 'add' || l.newLine === undefined) continue;
          const rule = RULES.find((r) => r.re.test(l.content));
          if (rule) comments.push({ file: f.newPath, line: l.newLine, body: rule.body, severity: rule.severity });
        }
    }
    return {
      comments: comments.slice(0, 10),
      usage: { inputTokens: Math.ceil(input.diff.length / 4), outputTokens: comments.length * 20, costUsd: 0, latencyMs: 1, model: 'mock' },
    };
  }
}

export class SilentReviewer implements Reviewer {
  readonly id = 'mock-silent-v1';
  async review(): Promise<ReviewResult> {
    return { comments: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, model: 'mock' } };
  }
}
