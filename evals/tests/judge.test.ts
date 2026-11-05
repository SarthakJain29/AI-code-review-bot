import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache.js';
import { KeywordJudge, LlmJudge, keywordOverlap, locationMatches, pathsMatch } from '../src/judge/judge.js';
import { MockProvider } from '../src/llm/provider.js';
import type { EvalCase, ReviewComment } from '../src/types.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bugCase: EvalCase = {
  id: 'o/r#1',
  kind: 'buggy',
  repo: 'o/r',
  pr: { number: 1, commit: 'abc', title: 'feat: x (#1)', url: null, date: '2024-01-01' },
  diff: '',
  diffStats: { files: 1, additions: 1, deletions: 0 },
  bug: {
    locations: [{ file: 'src/retry.ts', lines: { start: 40, end: 42 } }],
    description: 'The retry loop uses <= instead of <, so the request is retried one extra time beyond the limit.',
    category: 'logic',
    fixPr: { number: 2, commit: 'def', title: 'fix: retry count (#2)', url: null, date: '2024-02-01' },
    fixDiff: '-for (let i = 0; i <= limit; i++)\n+for (let i = 0; i < limit; i++)',
    szz: { blamedLines: 1, blamedLinesToIntroducer: 1, candidateIntroducers: 1 },
  },
};

const c = (file: string, line: number, body = 'x'): ReviewComment => ({ file, line, body, severity: 'major' });

describe('location matching', () => {
  it('matches same file within tolerance', () => {
    expect(locationMatches(c('src/retry.ts', 40), bugCase.bug!.locations)).toBe(true);
    expect(locationMatches(c('src/retry.ts', 47), bugCase.bug!.locations)).toBe(true); // 42+5
    expect(locationMatches(c('src/retry.ts', 48), bugCase.bug!.locations)).toBe(false);
    expect(locationMatches(c('src/retry.ts', 35), bugCase.bug!.locations)).toBe(true); // 40-5
    expect(locationMatches(c('src/retry.ts', 34), bugCase.bug!.locations)).toBe(false);
  });
  it('respects custom tolerance', () => {
    expect(locationMatches(c('src/retry.ts', 45), bugCase.bug!.locations, 0)).toBe(false);
    expect(locationMatches(c('src/retry.ts', 41), bugCase.bug!.locations, 0)).toBe(true);
  });
  it('rejects other files', () => expect(locationMatches(c('src/other.ts', 40), bugCase.bug!.locations)).toBe(false));
  it('normalises path prefixes', () => {
    expect(pathsMatch('b/src/retry.ts', 'src/retry.ts')).toBe(true);
    expect(pathsMatch('./src/retry.ts', 'src/retry.ts')).toBe(true);
    expect(pathsMatch('packages/x/src/retry.ts', 'src/retry.ts')).toBe(true);
    expect(pathsMatch('src/retry.tsx', 'src/retry.ts')).toBe(false);
    expect(pathsMatch('xsrc/retry.ts', 'src/retry.ts')).toBe(false);
  });
});

describe('keyword judge', () => {
  it('scores overlap of content words', () => {
    expect(keywordOverlap('retry loop extra time limit', 'the retry loop runs one extra time past the limit')).toBe(1);
    expect(keywordOverlap('retry loop', 'unrelated naming nit')).toBe(0);
    expect(keywordOverlap('', 'anything')).toBe(0);
  });
  it('requires both semantic and location for strict catch', async () => {
    const j = new KeywordJudge(0.25);
    const right = await j.judge(bugCase, [c('src/retry.ts', 41, 'Off by one: <= retries one extra time beyond the limit')]);
    expect(right.caught).toBe(true);
    const wrongLine = await j.judge(bugCase, [c('src/retry.ts', 200, 'Off by one: <= retries one extra time beyond the limit')]);
    expect(wrongLine.caught).toBe(false);
    expect(wrongLine.caughtAnyLocation).toBe(true);
    const wrongIssue = await j.judge(bugCase, [c('src/retry.ts', 41, 'Consider renaming variable i')]);
    expect(wrongIssue.caught).toBe(false);
    expect(wrongIssue.caughtAnyLocation).toBe(false);
  });
  it('returns not-caught for no comments', async () => {
    const v = await new KeywordJudge().judge(bugCase, []);
    expect(v.caught).toBe(false);
    expect(v.perComment).toEqual([]);
  });
});

describe('LLM judge', () => {
  const cache = () => new DiskCache(mkdtempSync(join(tmpdir(), 'judge-')));
  it('combines LLM semantic verdicts with deterministic location checks', async () => {
    const llm = new MockProvider(() =>
      JSON.stringify({ verdicts: [{ index: 0, match: true, reason: 'same bug' }, { index: 1, match: true, reason: 'same bug' }, { index: 2, match: false, reason: 'other' }] }),
    );
    const j = new LlmJudge(llm, cache());
    const v = await j.judge(bugCase, [c('src/retry.ts', 99), c('src/retry.ts', 41), c('src/retry.ts', 40)]);
    expect(v.caught).toBe(true);
    expect(v.matchedIndices).toEqual([1]);
    expect(v.perComment[0]).toMatchObject({ semanticMatch: true, locationMatch: false });
    expect(v.perComment[2]).toMatchObject({ semanticMatch: false, locationMatch: true });
  });
  it('treats missing verdicts as non-matching and does not call the LLM for zero comments', async () => {
    let calls = 0;
    const llm = new MockProvider(() => {
      calls++;
      return '{"verdicts": []}';
    });
    const j = new LlmJudge(llm, cache());
    expect((await j.judge(bugCase, [])).caught).toBe(false);
    expect(calls).toBe(0);
    expect((await j.judge(bugCase, [c('src/retry.ts', 41)])).caught).toBe(false);
    expect(calls).toBe(1);
  });
  it('only sends comments in bug files to the LLM and maps indices back', async () => {
    const prompts: string[] = [];
    const llm = new MockProvider((req) => {
      prompts.push(req.prompt);
      return JSON.stringify({ verdicts: [{ index: 0, match: true, reason: 'same bug' }] });
    });
    const j = new LlmJudge(llm, cache());
    const v = await j.judge(bugCase, [c('src/other.ts', 41, 'unrelated'), c('src/retry.ts', 41, 'off by one')]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('src/other.ts:41');
    expect(v.matchedIndices).toEqual([1]);
    expect(v.perComment[0]).toMatchObject({ semanticMatch: false, reason: expect.stringContaining('not in a bug file') });
    // no comment in a bug file -> no LLM call at all
    await j.judge(bugCase, [c('src/other.ts', 41, 'x')]);
    expect(prompts).toHaveLength(1);
  });
  it('caches verdicts', async () => {
    let calls = 0;
    const llm = new MockProvider(() => {
      calls++;
      return '```json\n{"verdicts":[{"index":0,"match":true,"reason":"r"}]}\n```';
    });
    const j = new LlmJudge(llm, cache());
    await j.judge(bugCase, [c('src/retry.ts', 41)]);
    const v = await j.judge(bugCase, [c('src/retry.ts', 41)]);
    expect(calls).toBe(1);
    expect(v.caught).toBe(true);
  });
});
