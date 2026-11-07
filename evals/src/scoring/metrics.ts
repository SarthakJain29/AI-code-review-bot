/** Pure scoring functions. Everything the scoreboard shows is computed here (and unit-tested). */
import type { BugCategory, CaseResult, Severity } from '../types.js';

export interface Rate {
  num: number;
  den: number;
  value: number | null;
  /** 95% Wilson score interval; honest error bars for small n. */
  ci: [number, number] | null;
}

export function wilson(num: number, den: number, z = 1.96): [number, number] | null {
  if (den === 0) return null;
  const p = num / den;
  const z2 = z * z;
  const centre = (p + z2 / (2 * den)) / (1 + z2 / den);
  const half = (z * Math.sqrt((p * (1 - p)) / den + z2 / (4 * den * den))) / (1 + z2 / den);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function rate(num: number, den: number): Rate {
  return { num, den, value: den === 0 ? null : num / den, ci: wilson(num, den) };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

const SERIOUS: Severity[] = ['critical', 'major'];

export interface Metrics {
  cases: { total: number; buggy: number; clean: number; errored: number };
  /** Recall: buggy cases where a comment matched the bug semantically AND by location. */
  catchRate: Rate;
  /** Same, but any line of a bug file (comment found the right bug but pointed at the wrong line). */
  catchRateAnyLocation: Rate;
  noise: {
    /** Mean comments per clean PR (every comment on a clean PR is a presumed false positive). */
    commentsPerCleanPr: number | null;
    seriousCommentsPerCleanPr: number | null;
    /** Share of clean PRs with zero comments. */
    silentOnClean: Rate;
    /** Mean comments per buggy PR. */
    commentsPerBuggyPr: number | null;
  };
  /**
   * Precision lower bound on buggy PRs: comments that match the known bug / all comments.
   * Other comments may still be valid, so true precision is >= this.
   */
  precisionLowerBound: Rate;
  /** Of PRs where the reviewer said anything serious, how often was there a real (known) bug? */
  seriousAlertPrecision: Rate;
  cost: { totalUsd: number; perReviewUsd: number | null; inputTokensPerReview: number | null; outputTokensPerReview: number | null };
  latencyMs: { mean: number | null; p50: number | null; p95: number | null };
  byCategory: { category: BugCategory; catchRate: Rate }[];
}

export function computeMetrics(results: CaseResult[]): Metrics {
  const buggy = results.filter((r) => r.kind === 'buggy');
  const clean = results.filter((r) => r.kind === 'clean');
  const caught = buggy.filter((r) => r.verdict?.caught).length;
  const caughtAny = buggy.filter((r) => r.verdict?.caughtAnyLocation).length;

  const buggyComments = buggy.reduce((a, r) => a + r.review.comments.length, 0);
  const matchedComments = buggy.reduce((a, r) => a + (r.verdict?.matchedIndices.length ?? 0), 0);
  const isSerious = (r: CaseResult) => r.review.comments.some((c) => SERIOUS.includes(c.severity));
  const alerted = results.filter(isSerious);

  const cats = new Map<BugCategory, CaseResult[]>();
  for (const r of buggy) if (r.category) cats.set(r.category, [...(cats.get(r.category) ?? []), r]);

  // Cached results keep the latency measured when the review originally ran.
  const lat = results.filter((r) => !r.review.error).map((r) => r.review.usage.latencyMs);
  const totalUsd = results.reduce((a, r) => a + r.review.usage.costUsd, 0);

  return {
    cases: { total: results.length, buggy: buggy.length, clean: clean.length, errored: results.filter((r) => r.review.error).length },
    catchRate: rate(caught, buggy.length),
    catchRateAnyLocation: rate(caughtAny, buggy.length),
    noise: {
      commentsPerCleanPr: mean(clean.map((r) => r.review.comments.length)),
      seriousCommentsPerCleanPr: mean(clean.map((r) => r.review.comments.filter((c) => SERIOUS.includes(c.severity)).length)),
      silentOnClean: rate(clean.filter((r) => r.review.comments.length === 0).length, clean.length),
      commentsPerBuggyPr: mean(buggy.map((r) => r.review.comments.length)),
    },
    precisionLowerBound: rate(matchedComments, buggyComments),
    seriousAlertPrecision: rate(alerted.filter((r) => r.kind === 'buggy').length, alerted.length),
    cost: {
      totalUsd,
      perReviewUsd: results.length ? totalUsd / results.length : null,
      inputTokensPerReview: mean(results.map((r) => r.review.usage.inputTokens)),
      outputTokensPerReview: mean(results.map((r) => r.review.usage.outputTokens)),
    },
    latencyMs: { mean: mean(lat), p50: percentile(lat, 50), p95: percentile(lat, 95) },
    byCategory: [...cats]
      .map(([category, rs]) => ({ category, catchRate: rate(rs.filter((r) => r.verdict?.caught).length, rs.length) }))
      .sort((a, b) => b.catchRate.den - a.catchRate.den || a.category.localeCompare(b.category)),
  };
}

/** Agreement between judge and human labels: accuracy + Cohen's kappa on the binary "caught" label. */
export interface Agreement {
  n: number;
  agree: number;
  accuracy: number | null;
  kappa: number | null;
  confusion: { tp: number; fp: number; fn: number; tn: number };
}

export function agreement(pairs: { human: boolean; judge: boolean }[]): Agreement {
  const n = pairs.length;
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  for (const { human, judge } of pairs) {
    if (human && judge) tp++;
    else if (!human && judge) fp++;
    else if (human && !judge) fn++;
    else tn++;
  }
  const agree = tp + tn;
  if (n === 0) return { n, agree, accuracy: null, kappa: null, confusion: { tp, fp, fn, tn } };
  const po = agree / n;
  const pe = ((tp + fp) / n) * ((tp + fn) / n) + ((fn + tn) / n) * ((fp + tn) / n);
  const kappa = pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return { n, agree, accuracy: po, kappa, confusion: { tp, fp, fn, tn } };
}
