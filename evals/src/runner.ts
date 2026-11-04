/** Runs a reviewer over a set of cases, judges buggy cases, caches every review. */
import { DiskCache } from './cache.js';
import type { Judge } from './judge/judge.js';
import type { CaseResult, EvalCase, ReviewResult, Reviewer, RunResult } from './types.js';

export interface RunOptions {
  reviewer: Reviewer;
  judge: Judge;
  cases: EvalCase[];
  cache: DiskCache;
  datasetVersion: number;
  /** Parallel reviews. Free tiers have low rate limits, so default to 1. */
  concurrency?: number;
  /** Re-run reviews even if cached. */
  noCache?: boolean;
  notes?: string[];
  onProgress?: (done: number, total: number, r: CaseResult) => void;
}

export function reviewCacheKey(reviewerId: string, c: EvalCase): string {
  return DiskCache.key('review', reviewerId, c.id, c.diff);
}

export async function runEval(opts: RunOptions): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const results: CaseResult[] = new Array(opts.cases.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < opts.cases.length) {
      const i = next++;
      const c = opts.cases[i]!;
      const key = reviewCacheKey(opts.reviewer.id, c);
      let review = opts.noCache ? undefined : opts.cache.get<ReviewResult>(key);
      const cached = review !== undefined;
      if (!review) {
        review = await opts.reviewer.review({ diff: c.diff, repo: c.repo, title: c.pr.title });
        if (!review.error) opts.cache.set(key, review); // never cache failures
      }
      let verdict;
      if (c.kind === 'buggy') {
        try {
          verdict = await opts.judge.judge(c, review.comments);
        } catch (e) {
          review = { ...review, error: `${review.error ? review.error + '; ' : ''}judge failed: ${(e as Error).message.slice(0, 200)}` };
        }
      }
      const r: CaseResult = { caseId: c.id, kind: c.kind, ...(c.bug ? { category: c.bug.category } : {}), review, ...(verdict ? { verdict } : {}), cached };
      results[i] = r;
      opts.onProgress?.(++done, opts.cases.length, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 1) }, worker));
  return {
    runId: `${startedAt.replace(/[:.]/g, '-')}_${opts.reviewer.id.replace(/[^a-zA-Z0-9.-]+/g, '_')}`,
    reviewerId: opts.reviewer.id,
    judgeId: opts.judge.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    datasetVersion: opts.datasetVersion,
    caseCount: opts.cases.length,
    results,
    notes: opts.notes ?? [],
  };
}

/** Pick a deterministic, stratified subset: n buggy + m clean, spread across repos. */
export function selectCases(cases: EvalCase[], opts: { limit?: number; ids?: string[]; kind?: 'buggy' | 'clean'; cleanShare?: number }): EvalCase[] {
  let pool = opts.ids?.length ? cases.filter((c) => opts.ids!.includes(c.id)) : cases;
  if (opts.kind) pool = pool.filter((c) => c.kind === opts.kind);
  if (!opts.limit || opts.limit >= pool.length) return pool;
  const nClean = opts.kind ? 0 : Math.min(pool.filter((c) => c.kind === 'clean').length, Math.round(opts.limit * (opts.cleanShare ?? 0.2)));
  const pick = (kind: 'buggy' | 'clean', n: number) => {
    // round-robin over repos so a small sample is still diverse
    const byRepo = new Map<string, EvalCase[]>();
    for (const c of pool.filter((x) => x.kind === kind)) byRepo.set(c.repo, [...(byRepo.get(c.repo) ?? []), c]);
    const queues = [...byRepo.values()];
    const out: EvalCase[] = [];
    for (let i = 0; out.length < n && queues.some((q) => q.length > 0); i++) {
      const q = queues[i % queues.length]!;
      const c = q.shift();
      if (c) out.push(c);
    }
    return out;
  };
  const kind = opts.kind;
  if (kind) return pick(kind, opts.limit);
  return [...pick('buggy', opts.limit - nClean), ...pick('clean', nClean)];
}
