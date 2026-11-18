/**
 * Dataset builder: mines bug-introducing PRs from public TS/JS repos with an SZZ-style pipeline.
 *
 *   merged fix PR (squash commit "fix(x): ... (#123)")
 *     -> lines the fix deleted/modified in source files
 *     -> git blame on the fix's parent -> commit that last touched those lines (majority vote)
 *     -> that commit's PR (squash commit "...(#99)") = bug-introducing PR
 *     -> store its diff, the blamed lines as the bug location, the fix diff and a description
 *
 * Clean cases are feat/perf/refactor PRs old enough for bugs to surface, that no later fix
 * commit blames back to.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DiskCache } from '../cache.js';
import { diffStats, filterReviewableDiff, isSourceFile, isTestFile, parseDiff, renderDiff, type DiffFile } from '../diff.js';
import type { LlmProvider } from '../llm/provider.js';
import { DatasetSchema, type Dataset, type EvalCase } from '../types.js';
import { annotate } from './annotate.js';
import {
  isCleanCandidateSubject,
  isFixCandidateSubject,
  isMechanicalSubject,
  isTrivialLine,
  pickIntroducer,
  prNumberFromSubject,
  toRanges,
  type BlamedLine,
} from './filters.js';
import { blameRange, commitInfo, ensureClone, firstParentLog, git, type CommitInfo } from './git.js';
import { fetchPrMeta, probeGithubApi } from './github.js';

export const DEFAULT_REPOS = [
  'vuejs/core',
  'sveltejs/svelte',
  'vitest-dev/vitest',
  'TanStack/query',
  'honojs/hono',
  'colinhacks/zod',
  'axios/axios',
  'date-fns/date-fns',
  'pmndrs/zustand',
  'immerjs/immer',
  'sindresorhus/ky',
  'unjs/h3',
];

export interface BuildOptions {
  repos: string[];
  reposDir: string;
  out: string;
  perRepoBuggy: number;
  perRepoClean: number;
  /** Max fix commits to examine per repo before giving up. */
  scanLimit: number;
  maxIntroLines: number;
  maxIntroFiles: number;
  llm: LlmProvider | null;
  cache: DiskCache;
  /** Keep existing cases in `out` and only add new ones. */
  extend: boolean;
}

const LIMITS = {
  maxFixSourceFiles: 3,
  maxFixChangedSourceLines: 60,
  maxFixDeletedSourceLines: 25,
  minIntroducerShare: 0.5,
  maxFixDiffChars: 20_000,
  /** Clean PRs must be at least this old so latent bugs had time to be found. */
  cleanMinAgeDays: 270,
};

function showDiff(dir: string, sha: string, context = 3): DiffFile[] {
  return parseDiff(git(dir, ['show', '--format=', '-M', `-U${context}`, '--no-color', sha]));
}

function prUrl(repo: string, n: number | null): string | null {
  return n === null ? null : `https://github.com/${repo}/pull/${n}`;
}

function prRef(repo: string, c: CommitInfo) {
  const number = prNumberFromSubject(c.subject);
  return { number, commit: c.sha, title: c.subject, url: prUrl(repo, number), date: c.date };
}

interface SzzResult {
  intro: CommitInfo;
  blamed: BlamedLine[];
  pick: NonNullable<ReturnType<typeof pickIntroducer>>;
}

/** Run SZZ for one fix commit. Returns null (with a reason) when the pair is unusable. */
function szz(dir: string, fix: CommitInfo): SzzResult | string {
  const parent = fix.parents[0];
  if (!parent) return 'no parent';
  const files = showDiff(dir, fix.sha, 0);
  const src = files.filter((f) => f.oldPath && f.newPath && isSourceFile(f.newPath));
  if (src.length === 0) return 'no modified source files';
  if (src.length > LIMITS.maxFixSourceFiles) return 'fix touches too many source files';
  const st = diffStats(src);
  if (st.additions + st.deletions > LIMITS.maxFixChangedSourceLines) return 'fix too large';
  const blamed: BlamedLine[] = [];
  let deleted = 0;
  for (const f of src) {
    const dels = f.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'del' && !isTrivialLine(l.content)));
    deleted += dels.length;
    for (const r of toRanges(dels.map((l) => l.oldLine!), 0)) {
      try {
        for (const b of blameRange(dir, parent, f.oldPath!, r.start, r.end)) if (!b.boundary) blamed.push(b);
      } catch {
        /* file renamed / blame failed: ignore this range */
      }
    }
  }
  if (deleted === 0) return 'fix only adds lines (nothing to blame)';
  if (deleted > LIMITS.maxFixDeletedSourceLines) return 'fix rewrites too much';
  const pick = pickIntroducer(blamed);
  if (!pick) return 'blame found nothing';
  if (pick.count / pick.total < LIMITS.minIntroducerShare) return 'no majority introducer';
  const intro = commitInfo(dir, pick.sha);
  if (intro.sha === fix.sha) return 'introducer == fix';
  if (intro.parents.length !== 1) return 'introducer is a merge/root commit';
  if (prNumberFromSubject(intro.subject) === null) return 'introducer has no PR number';
  if (isMechanicalSubject(intro.subject)) return 'introducer is mechanical';
  return { intro, blamed: blamed.filter((b) => b.sha === pick.sha), pick };
}

function snippet(files: DiffFile[], file: string, start: number, end: number): string {
  const f = files.find((x) => x.newPath === file);
  if (!f) return '';
  const out: string[] = [];
  for (const h of f.hunks)
    for (const l of h.lines)
      if (l.newLine !== undefined && l.newLine >= start - 3 && l.newLine <= end + 3)
        out.push(`${String(l.newLine).padStart(5)} ${l.type === 'add' ? '+' : ' '}${l.content}`);
  return `${file}\n${out.join('\n')}`;
}

async function buildBuggy(repo: string, dir: string, log: CommitInfo[], opts: BuildOptions, seen: Set<string>): Promise<EvalCase[]> {
  const out: EvalCase[] = [];
  const fixes = log.filter((c) => isFixCandidateSubject(c.subject)).slice(0, opts.scanLimit);
  const reasons = new Map<string, number>();
  const bump = (r: string) => reasons.set(r, (reasons.get(r) ?? 0) + 1);
  let examined = 0;
  for (const fix of fixes) {
    if (out.length >= opts.perRepoBuggy) break;
    examined++;
    const r = szz(dir, fix);
    if (typeof r === 'string') {
      bump(r);
      continue;
    }
    const { intro, blamed, pick } = r;
    const id = `${repo}#${prNumberFromSubject(intro.subject)}`;
    if (seen.has(id)) {
      bump('duplicate introducer');
      continue;
    }
    if (new Date(intro.date) >= new Date(fix.date)) {
      bump('introducer not older than fix');
      continue;
    }
    const introFiles = filterReviewableDiff(showDiff(dir, intro.sha));
    const st = diffStats(introFiles);
    if (st.additions + st.deletions > opts.maxIntroLines || st.files > opts.maxIntroFiles) {
      bump('introducing diff too large');
      continue;
    }
    // Keep blamed lines that are actually *added* lines of the introducing diff.
    const byFile = new Map<string, number[]>();
    for (const b of blamed) {
      const f = introFiles.find((x) => x.newPath === b.origFile);
      const added = f?.hunks.some((h) => h.lines.some((l) => l.type === 'add' && l.newLine === b.origLine));
      if (added) byFile.set(b.origFile, [...(byFile.get(b.origFile) ?? []), b.origLine]);
    }
    const locations = [...byFile].flatMap(([file, nums]) => toRanges(nums).map((lines) => ({ file, lines })));
    if (locations.length === 0) {
      bump('blamed lines not in introducing diff');
      continue;
    }
    // Source changes first, tests after, so truncation never hides the actual fix.
    const fixFiles = filterReviewableDiff(showDiff(dir, fix.sha)).sort(
      (a, b) => Number(isTestFile(a.newPath ?? a.oldPath ?? '')) - Number(isTestFile(b.newPath ?? b.oldPath ?? '')),
    );
    const fixDiff = renderDiff(fixFiles).slice(0, LIMITS.maxFixDiffChars);
    const bugSnippet = locations.map((l) => snippet(introFiles, l.file, l.lines.start, l.lines.end)).join('\n\n');
    const fixNo = prNumberFromSubject(fix.subject);
    const meta = fixNo ? await fetchPrMeta(repo, fixNo) : null;
    const ann = await annotate(
      { repo, fixSubject: fix.subject, fixBody: meta?.body ? meta.body : fix.body, fixDiff, introSubject: intro.subject, bugSnippet },
      opts.llm,
      opts.cache,
    );
    if (!ann.isLogicBug) {
      bump(`annotator rejected`);
      continue;
    }
    seen.add(id);
    out.push({
      id,
      kind: 'buggy',
      repo,
      pr: prRef(repo, intro),
      diff: renderDiff(introFiles),
      diffStats: st,
      bug: {
        locations,
        description: ann.description,
        category: ann.category,
        fixPr: prRef(repo, fix),
        fixDiff,
        szz: { blamedLines: pick.total, blamedLinesToIntroducer: pick.count, candidateIntroducers: pick.candidates },
      },
      annotation: { by: ann.by, ...(ann.model ? { model: ann.model } : {}) },
    });
    console.log(`  + buggy ${id} <- fixed by #${fixNo} [${ann.category}]`);
  }
  console.log(`  ${repo}: examined ${examined}/${fixes.length} fix commits; skipped: ${[...reasons].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  return out;
}

function laterFixesBlameTo(dir: string, cand: CommitInfo, files: string[], fixes: CommitInfo[]): boolean {
  // Later fix commits that touched any of the candidate's files.
  const touched = new Set(
    git(dir, ['log', '--first-parent', '--format=%H', `${cand.sha}..HEAD`, '--', ...files])
      .split('\n')
      .filter(Boolean),
  );
  const relevant = fixes.filter((f) => touched.has(f.sha)).slice(0, 15);
  for (const f of relevant) {
    const r = szz(dir, f);
    if (typeof r !== 'string' && r.intro.sha === cand.sha) return true;
  }
  return false;
}

function buildClean(repo: string, dir: string, log: CommitInfo[], opts: BuildOptions, seen: Set<string>): EvalCase[] {
  const out: EvalCase[] = [];
  const head = log[0];
  if (!head) return out;
  const cutoff = new Date(head.date).getTime() - LIMITS.cleanMinAgeDays * 86_400_000;
  const fixes = log.filter((c) => /^fix/i.test(c.subject));
  const cands = log.filter((c) => isCleanCandidateSubject(c.subject) && new Date(c.date).getTime() < cutoff && c.parents.length === 1);
  for (const c of cands) {
    if (out.length >= opts.perRepoClean) break;
    const id = `${repo}#${prNumberFromSubject(c.subject)}`;
    if (seen.has(id)) continue;
    const files = filterReviewableDiff(showDiff(dir, c.sha));
    const st = diffStats(files);
    const srcFiles = files.filter((f) => f.newPath && isSourceFile(f.newPath));
    if (srcFiles.length === 0 || st.additions + st.deletions < 15) continue;
    if (st.additions + st.deletions > Math.min(opts.maxIntroLines, 400) || st.files > opts.maxIntroFiles) continue;
    const prNo = prNumberFromSubject(c.subject);
    if (log.some((x) => /^revert/i.test(x.subject) && prNo !== null && x.subject.includes(`#${prNo}`))) continue;
    if (laterFixesBlameTo(dir, c, srcFiles.map((f) => f.newPath!), fixes)) continue;
    seen.add(id);
    out.push({ id, kind: 'clean', repo, pr: prRef(repo, c), diff: renderDiff(files), diffStats: st });
    console.log(`  + clean ${id}`);
  }
  return out;
}

export async function buildDataset(opts: BuildOptions): Promise<Dataset> {
  const existing: EvalCase[] =
    opts.extend && existsSync(opts.out) ? DatasetSchema.parse(JSON.parse(readFileSync(opts.out, 'utf8'))).cases : [];
  const seen = new Set(existing.map((c) => c.id));
  const firstRepo = opts.repos[0];
  let source = 'git-history SZZ (GitHub REST API unavailable)';
  if (firstRepo) {
    const probe = await probeGithubApi(firstRepo);
    console.log(`GitHub REST API probe (${firstRepo}): ${probe.ok ? 'available' : `unavailable (${probe.status ?? 'network'})`}`);
    if (probe.ok) source = 'git-history SZZ + GitHub REST PR metadata';
  }
  const cases = [...existing];
  for (const repo of opts.repos) {
    console.log(`\n== ${repo}`);
    try {
      const dir = ensureClone(opts.reposDir, repo);
      const log = firstParentLog(dir);
      const have = (k: 'buggy' | 'clean') => cases.filter((c) => c.repo === repo && c.kind === k).length;
      const buggy = await buildBuggy(repo, dir, log, { ...opts, perRepoBuggy: Math.max(0, opts.perRepoBuggy - have('buggy')) }, seen);
      const clean = buildClean(repo, dir, log, { ...opts, perRepoClean: Math.max(0, opts.perRepoClean - have('clean')) }, seen);
      cases.push(...buggy, ...clean);
    } catch (e) {
      console.warn(`  ! ${repo} failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  const ds: Dataset = DatasetSchema.parse({ version: 1, generatedAt: new Date().toISOString(), source, cases });
  writeFileSync(opts.out, JSON.stringify(ds, null, 2) + '\n');
  console.log(`\nWrote ${cases.length} cases (${cases.filter((c) => c.kind === 'buggy').length} buggy, ${cases.filter((c) => c.kind === 'clean').length} clean) -> ${opts.out}`);
  return ds;
}
