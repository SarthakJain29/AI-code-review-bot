import { describe, expect, it } from 'vitest';
import { commentableLines, diffStats, filterReviewableDiff, isSourceFile, parseDiff, renderNumberedDiff } from '../src/diff.js';
import {
  cleanSubject,
  isCleanCandidateSubject,
  isFixCandidateSubject,
  isTrivialLine,
  pickIntroducer,
  prNumberFromSubject,
  toRanges,
} from '../src/dataset/filters.js';
import { parsePorcelain } from '../src/dataset/git.js';
import { parseReviewOutput } from '../src/reviewers/baseline.js';
import { selectCases } from '../src/runner.js';
import type { EvalCase } from '../src/types.js';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,5 @@ export function f() {
   const a = 1
-  const b = 2
+  const b = 3
+  const c = 4
   return a
 }
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1 @@
-x
+y
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1
+export const y = 2
`;

describe('parseDiff', () => {
  const files = parseDiff(DIFF);
  it('parses files and line numbers', () => {
    expect(files.map((f) => f.newPath)).toEqual(['src/a.ts', 'pnpm-lock.yaml', 'src/new.ts']);
    const h = files[0]!.hunks[0]!;
    expect(h.lines.filter((l) => l.type === 'add').map((l) => l.newLine)).toEqual([11, 12]);
    expect(h.lines.filter((l) => l.type === 'del').map((l) => l.oldLine)).toEqual([11]);
    expect(files[2]!.oldPath).toBeNull();
  });
  it('filters noise files and counts stats', () => {
    const kept = filterReviewableDiff(files);
    expect(kept.map((f) => f.newPath)).toEqual(['src/a.ts', 'src/new.ts']);
    expect(diffStats(kept)).toEqual({ files: 2, additions: 4, deletions: 1 });
  });
  it('lists commentable new-side lines', () => {
    const m = commentableLines(files);
    expect([...m.get('src/a.ts')!]).toEqual([10, 11, 12, 13, 14]);
  });
  it('renders numbered diffs', () => {
    expect(renderNumberedDiff([files[2]!])).toContain('    1 +export const x = 1');
  });
});

describe('source-file classification', () => {
  it.each([
    ['packages/runtime-core/src/renderer.ts', true],
    ['src/index.js', true],
    ['src/Comp.vue', true],
    ['src/__tests__/a.spec.ts', false],
    ['test/foo.ts', false],
    ['src/a.test.ts', false],
    ['src/types.d.ts', false],
    ['docs/guide.md', false],
    ['dist/index.js', false],
  ])('%s -> %s', (p, want) => expect(isSourceFile(p)).toBe(want));
});

describe('commit subject filters', () => {
  it('extracts PR numbers', () => {
    expect(prNumberFromSubject('fix(core): x (#123)')).toBe(123);
    expect(prNumberFromSubject('Merge pull request #45 from a/b')).toBe(45);
    expect(prNumberFromSubject('fix: x')).toBeNull();
  });
  it('selects logic fix commits only', () => {
    expect(isFixCandidateSubject('fix(runtime-core): handle null vnode (#123)')).toBe(true);
    expect(isFixCandidateSubject('fix(types): widen props type (#1)')).toBe(false);
    expect(isFixCandidateSubject('fix: typo in docs (#1)')).toBe(false);
    expect(isFixCandidateSubject('fix(deps): update vite (#1)')).toBe(false);
    expect(isFixCandidateSubject('fix: handle null vnode')).toBe(false); // no PR
    expect(isFixCandidateSubject('feat: x (#1)')).toBe(false);
    expect(isFixCandidateSubject('Revert "fix: x (#1)" (#2)')).toBe(false);
  });
  it('selects clean candidates', () => {
    expect(isCleanCandidateSubject('feat(router): add basename option (#9)')).toBe(true);
    expect(isCleanCandidateSubject('feat(types): x (#9)')).toBe(false);
    expect(isCleanCandidateSubject('fix: x (#9)')).toBe(false);
  });
  it('cleans subjects', () => expect(cleanSubject('fix(core): handle x (#12)')).toBe('handle x'));
  it('flags trivial lines', () => {
    expect(isTrivialLine('   }')).toBe(true);
    expect(isTrivialLine('  // hi')).toBe(true);
    expect(isTrivialLine('')).toBe(true);
    expect(isTrivialLine('  return x')).toBe(false);
  });
});

describe('SZZ helpers', () => {
  it('picks the majority introducer', () => {
    const p = pickIntroducer([
      { sha: 'a', origFile: 'f', origLine: 1 },
      { sha: 'b', origFile: 'f', origLine: 2 },
      { sha: 'a', origFile: 'f', origLine: 3 },
    ])!;
    expect(p).toEqual({ sha: 'a', count: 2, total: 3, candidates: 2 });
    expect(pickIntroducer([])).toBeNull();
  });
  it('merges line ranges with a gap', () => {
    expect(toRanges([5, 1, 2, 10, 3])).toEqual([
      { start: 1, end: 5 },
      { start: 10, end: 10 },
    ]);
    expect(toRanges([1, 2, 5], 0)).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 5 },
    ]);
  });
  it('parses git blame porcelain', () => {
    const sha1 = 'a'.repeat(40);
    const sha2 = 'b'.repeat(40);
    const out = [
      `${sha1} 10 20 2`,
      'author X',
      'filename src/old.ts',
      '\tline one',
      `${sha1} 11 21`,
      '\tline two',
      `${sha2} 3 22 1`,
      'boundary',
      'filename src/b.ts',
      '\tline three',
      '',
    ].join('\n');
    expect(parsePorcelain(out)).toEqual([
      { sha: sha1, origLine: 10, origFile: 'src/old.ts', boundary: false },
      { sha: sha1, origLine: 11, origFile: 'src/old.ts', boundary: false },
      { sha: sha2, origLine: 3, origFile: 'src/b.ts', boundary: true },
    ]);
  });
});

describe('baseline output parsing', () => {
  it('parses fenced JSON, coerces lines and snaps file paths', () => {
    const out = parseReviewOutput(
      '```json\n{"comments":[{"file":"b/src/a.ts","line":"11","severity":"major","body":" bug "},{"file":"a.ts","line":12,"severity":"weird","body":"x"}]}\n```',
      DIFF,
    );
    expect(out).toEqual([
      { file: 'src/a.ts', line: 11, severity: 'major', body: 'bug' },
      { file: 'src/a.ts', line: 12, severity: 'minor', body: 'x' },
    ]);
  });
  it('tolerates an empty/malformed comments array', () => expect(parseReviewOutput('{"comments": "none"}', DIFF)).toEqual([]));
});

describe('selectCases', () => {
  const mk = (id: string, repo: string, kind: 'buggy' | 'clean'): EvalCase => ({
    id,
    kind,
    repo,
    pr: { number: 1, commit: 'x', title: 't', url: null, date: 'd' },
    diff: '',
    diffStats: { files: 0, additions: 0, deletions: 0 },
  });
  const cases = [mk('a1', 'a', 'buggy'), mk('a2', 'a', 'buggy'), mk('b1', 'b', 'buggy'), mk('c1', 'c', 'clean'), mk('c2', 'c', 'clean')];
  it('round-robins repos and keeps a clean share', () => {
    expect(selectCases(cases, { limit: 4 }).map((c) => c.id)).toEqual(['a1', 'b1', 'a2', 'c1']);
    expect(selectCases(cases, { limit: 10 })).toHaveLength(5);
    expect(selectCases(cases, { limit: 3 }).map((c) => c.id)).toEqual(['a1', 'b1', 'c1']);
  });
  it('filters by ids and kind', () => {
    expect(selectCases(cases, { ids: ['b1', 'c2'] }).map((c) => c.id)).toEqual(['b1', 'c2']);
    expect(selectCases(cases, { kind: 'clean' }).map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
