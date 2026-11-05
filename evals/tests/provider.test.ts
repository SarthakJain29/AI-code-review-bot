import { describe, expect, it } from 'vitest';
import { parseDiff, renderNumberedDiff } from '../src/diff.js';
import { estimateTokens, isDailyQuotaMessage, LlmError, MockProvider, TpmLimiter } from '../src/llm/provider.js';
import { BaselineReviewer, chunkDiff } from '../src/reviewers/baseline.js';
import type { LlmProvider, LlmRequest, LlmResponse } from '../src/llm/provider.js';

describe('TpmLimiter', () => {
  function fakeClock() {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms), get t() { return t; } };
  }
  it('lets requests through until the window is full, then waits for the oldest to expire', async () => {
    const c = fakeClock();
    const l = new TpmLimiter(1000, c.now, c.sleep);
    expect(await l.acquire(600)).toBe(0);
    expect(await l.acquire(300)).toBe(0);
    const waited = await l.acquire(300); // 1200 > 1000: must wait ~60s
    expect(waited).toBeGreaterThanOrEqual(60_000);
    expect(c.t).toBeGreaterThanOrEqual(60_000);
  });
  it('caps a single oversized request at the limit instead of waiting forever', async () => {
    const c = fakeClock();
    const l = new TpmLimiter(1000, c.now, c.sleep);
    expect(await l.acquire(5000)).toBe(0);
  });
});

describe('isDailyQuotaMessage', () => {
  it('detects Groq TPD/RPD and Gemini daily quota messages', () => {
    expect(isDailyQuotaMessage('Rate limit reached for model `x` on tokens per day (TPD): Limit 200000')).toBe(true);
    expect(isDailyQuotaMessage('Quota exceeded for metric: generate_content_free_tier_requests ... GenerateRequestsPerDayPerProjectPerModel')).toBe(true);
    expect(isDailyQuotaMessage('Rate limit reached for model `x` on tokens per minute (TPM): Limit 8000')).toBe(false);
  });
});

function bigDiff(files: number, hunksPerFile: number, linesPerHunk: number): string {
  let out = '';
  for (let f = 0; f < files; f++) {
    out += `diff --git a/src/f${f}.ts b/src/f${f}.ts\n--- a/src/f${f}.ts\n+++ b/src/f${f}.ts\n`;
    for (let h = 0; h < hunksPerFile; h++) {
      const start = h * 100 + 1;
      out += `@@ -${start},0 +${start},${linesPerHunk} @@\n`;
      for (let i = 0; i < linesPerHunk; i++) out += `+const value_${f}_${h}_${i} = computeSomethingLong(${i}, "padding padding padding");\n`;
    }
  }
  return out;
}

describe('chunkDiff', () => {
  it('keeps small diffs in one chunk', () => {
    const files = parseDiff(bigDiff(2, 1, 5));
    expect(chunkDiff(files, 4500)).toHaveLength(1);
  });
  it('splits by file, then by hunk, never dropping lines', () => {
    const files = parseDiff(bigDiff(3, 4, 40));
    const chunks = chunkDiff(files, 1500);
    expect(chunks.length).toBeGreaterThan(3);
    const added = (fs: typeof files) => fs.flatMap((f) => f.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add').map((l) => `${f.newPath}:${l.newLine}`)));
    expect(chunks.flatMap((c) => added(c)).sort()).toEqual(added(files).sort());
    for (const c of chunks) if (c.length > 1 || c[0]!.hunks.length > 1) expect(estimateTokens(renderNumberedDiff(c))).toBeLessThanOrEqual(1500);
  });
});

describe('BaselineReviewer', () => {
  const diff = bigDiff(3, 2, 30);
  it('reviews each chunk and merges comments + usage', async () => {
    const prompts: string[] = [];
    const llm = new MockProvider((req: LlmRequest) => {
      prompts.push(req.prompt);
      const file = /=== FILE: (\S+)/.exec(req.prompt)![1];
      return JSON.stringify({ comments: [{ file, line: 1, severity: 'major', body: 'x' }] });
    });
    const r = await new BaselineReviewer(llm, { chunkTokens: 1200 }).review({ diff, repo: 'o/r', title: 't' });
    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts[0]).toContain('(part 1 of');
    expect(r.comments).toHaveLength(prompts.length);
    expect(r.usage.calls).toBe(prompts.length);
  });
  it('flags daily-quota failures so the runner can stop and resume', async () => {
    const failing: LlmProvider = {
      name: 'groq',
      model: 'm',
      complete: async (): Promise<LlmResponse> => {
        throw new LlmError('HTTP 429: tokens per day (TPD)', 429, false, undefined, true);
      },
    };
    const r = await new BaselineReviewer(failing).review({ diff, repo: 'o/r', title: 't' });
    expect(r.quotaExhausted).toBe(true);
    expect(r.error).toContain('429');
    expect(r.comments).toEqual([]);
  });
});

describe('runEval quota stop + resume', async () => {
  const { runEval } = await import('../src/runner.js');
  const { KeywordJudge } = await import('../src/judge/judge.js');
  const { DiskCache } = await import('../src/cache.js');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const mk = (id: string) => ({
    id,
    kind: 'clean' as const,
    repo: 'o/r',
    pr: { number: 1, commit: 'c', title: 't', url: null, date: 'd' },
    diff: `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+${id}\n`,
    diffStats: { files: 1, additions: 1, deletions: 0 },
  });
  it('leaves cases pending after a daily-quota error and resumes from cache', async () => {
    const cache = new DiskCache(mkdtempSync(join(tmpdir(), 'run-')));
    let budget = 2;
    let calls = 0;
    const reviewer = {
      id: 'r',
      review: async () => {
        calls++;
        if (budget-- <= 0) return { comments: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, model: 'm' }, error: 'TPD', quotaExhausted: true };
        return { comments: [], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 5, model: 'm' } };
      },
    };
    const cases = ['a', 'b', 'c', 'd'].map(mk);
    const first = await runEval({ reviewer, judge: new KeywordJudge(), cases, cache, datasetVersion: 1 });
    expect(first.results.map((r) => r.caseId)).toEqual(['a', 'b']);
    expect(first.pending).toEqual(['c', 'd']);
    expect(first.notes.join(' ')).toContain('quota');
    budget = 10;
    calls = 0;
    const second = await runEval({ reviewer, judge: new KeywordJudge(), cases, cache, datasetVersion: 1 });
    expect(second.pending).toEqual([]);
    expect(second.results.filter((r) => r.cached).map((r) => r.caseId)).toEqual(['a', 'b']);
    expect(calls).toBe(2);
    // A fresh cache (e.g. new container) can resume from the previous results file alone.
    calls = 0;
    const third = await runEval({ reviewer, judge: new KeywordJudge(), cases, cache: new DiskCache(mkdtempSync(join(tmpdir(), 'run2-'))), datasetVersion: 1, previous: second });
    expect(third.results).toHaveLength(4);
    expect(calls).toBe(0);
  });
});
