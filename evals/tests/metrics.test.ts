import { describe, expect, it } from 'vitest';
import { agreement, computeMetrics, percentile, rate, wilson } from '../src/scoring/metrics.js';
import type { CaseResult, ReviewComment } from '../src/types.js';

const usage = (latencyMs = 100, costUsd = 0.001) => ({ inputTokens: 1000, outputTokens: 100, costUsd, latencyMs, model: 'm' });
const cm = (severity: ReviewComment['severity'] = 'major'): ReviewComment => ({ file: 'a.ts', line: 1, body: 'x', severity });

function buggy(id: string, caught: boolean, opts: { any?: boolean; comments?: number; matched?: number; category?: CaseResult['category'] } = {}): CaseResult {
  const n = opts.comments ?? (caught ? 1 : 0);
  return {
    caseId: id,
    kind: 'buggy',
    category: opts.category ?? 'logic',
    review: { comments: Array.from({ length: n }, () => cm()), usage: usage() },
    verdict: {
      caught,
      caughtAnyLocation: opts.any ?? caught,
      matchedIndices: Array.from({ length: opts.matched ?? (caught ? 1 : 0) }, (_, i) => i),
      perComment: [],
      judgeModel: 'j',
    },
    cached: false,
  };
}
function clean(id: string, severities: ReviewComment['severity'][]): CaseResult {
  return { caseId: id, kind: 'clean', review: { comments: severities.map(cm), usage: usage() }, cached: false };
}

describe('wilson', () => {
  it('returns null for n=0', () => expect(wilson(0, 0)).toBeNull());
  it('brackets the point estimate and stays in [0,1]', () => {
    const [lo, hi] = wilson(3, 10)!;
    expect(lo).toBeLessThan(0.3);
    expect(hi).toBeGreaterThan(0.3);
    expect(wilson(0, 5)![0]).toBe(0);
    expect(wilson(5, 5)![1]).toBeCloseTo(1, 10);
  });
  it('matches a known value (7/10 -> ~0.397-0.892)', () => {
    const [lo, hi] = wilson(7, 10)!;
    expect(lo).toBeCloseTo(0.3968, 3);
    expect(hi).toBeCloseTo(0.8922, 3);
  });
});

describe('percentile', () => {
  it('interpolates', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3], 0)).toBe(1);
  });
});

describe('computeMetrics', () => {
  const results: CaseResult[] = [
    buggy('b1', true, { comments: 3, matched: 1, category: 'logic' }),
    buggy('b2', false, { any: true, comments: 2, category: 'logic' }),
    buggy('b3', false, { comments: 0, category: 'null-undefined' }),
    buggy('b4', true, { comments: 1, matched: 1, category: 'null-undefined' }),
    clean('c1', []),
    clean('c2', ['nit', 'major']),
  ];
  const m = computeMetrics(results);

  it('computes strict and lenient catch rate', () => {
    expect(m.catchRate.num).toBe(2);
    expect(m.catchRate.den).toBe(4);
    expect(m.catchRate.value).toBe(0.5);
    expect(m.catchRateAnyLocation.num).toBe(3);
  });
  it('computes noise on clean PRs', () => {
    expect(m.noise.commentsPerCleanPr).toBe(1);
    expect(m.noise.seriousCommentsPerCleanPr).toBe(0.5);
    expect(m.noise.silentOnClean.value).toBe(0.5);
    expect(m.noise.commentsPerBuggyPr).toBe(1.5);
  });
  it('computes precision lower bound over buggy-PR comments', () => {
    expect(m.precisionLowerBound.num).toBe(2);
    expect(m.precisionLowerBound.den).toBe(6);
  });
  it('computes serious-alert precision', () => {
    // PRs with a critical/major comment: b1, b2, b4 (buggy) and c2 (clean)
    expect(m.seriousAlertPrecision.num).toBe(3);
    expect(m.seriousAlertPrecision.den).toBe(4);
  });
  it('computes cost and latency', () => {
    expect(m.cost.totalUsd).toBeCloseTo(0.006);
    expect(m.cost.perReviewUsd).toBeCloseTo(0.001);
    expect(m.latencyMs.p50).toBe(100);
  });
  it('breaks down by category', () => {
    const logic = m.byCategory.find((c) => c.category === 'logic')!;
    expect(logic.catchRate.num).toBe(1);
    expect(logic.catchRate.den).toBe(2);
  });
  it('excludes errored reviews from latency and counts them', () => {
    const e = computeMetrics([{ ...clean('c', []), review: { comments: [], usage: usage(99999), error: 'boom' } }, clean('d', [])]);
    expect(e.cases.errored).toBe(1);
    expect(e.latencyMs.p95).toBe(100);
  });
  it('handles empty input', () => {
    const e = computeMetrics([]);
    expect(e.catchRate.value).toBeNull();
    expect(e.noise.commentsPerCleanPr).toBeNull();
  });
});

describe('agreement', () => {
  it('perfect agreement gives kappa 1', () => {
    const a = agreement([
      { human: true, judge: true },
      { human: false, judge: false },
    ]);
    expect(a.accuracy).toBe(1);
    expect(a.kappa).toBe(1);
  });
  it('computes kappa for a known table', () => {
    // tp=20 fp=5 fn=10 tn=15 -> po=0.7, pe=0.5 -> kappa=0.4
    const pairs = [
      ...Array.from({ length: 20 }, () => ({ human: true, judge: true })),
      ...Array.from({ length: 5 }, () => ({ human: false, judge: true })),
      ...Array.from({ length: 10 }, () => ({ human: true, judge: false })),
      ...Array.from({ length: 15 }, () => ({ human: false, judge: false })),
    ];
    const a = agreement(pairs);
    expect(a.accuracy).toBeCloseTo(0.7);
    expect(a.kappa).toBeCloseTo(0.4);
    expect(a.confusion).toEqual({ tp: 20, fp: 5, fn: 10, tn: 15 });
  });
  it('handles all-same labels without dividing by zero', () => {
    expect(agreement([{ human: true, judge: true }]).kappa).toBe(1);
    expect(agreement([]).accuracy).toBeNull();
  });
});

describe('rate', () => {
  it('null value for empty denominators', () => expect(rate(0, 0).value).toBeNull());
});
