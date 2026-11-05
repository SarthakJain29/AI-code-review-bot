#!/usr/bin/env node
/**
 * Diffwise evals CLI.
 *   npm run evals -- dataset build            # mine cases (SZZ) into dataset/cases.json
 *   npm run evals -- dataset stats
 *   npm run evals -- run --reviewer baseline --limit 5
 *   npm run evals -- judge validate
 *   npm run evals -- report --runs results/a.json,results/b.json --out reports/scoreboard
 */
import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DiskCache } from './cache.js';
import { CACHE_DIR, DATASET_PATH, LABELS_PATH, loadDotEnv, REPORTS_DIR, RESULTS_DIR, ROOT } from './config.js';
import { buildDataset, DEFAULT_REPOS } from './dataset/build.js';
import { KeywordJudge, LlmJudge, type Judge } from './judge/judge.js';
import { loadLabels, validateJudge } from './judge/validate.js';
import { providerChainFromEnv, providerFromEnv, type ProviderName } from './llm/provider.js';
import { renderHtml, renderMarkdown, type JudgeValidation } from './report/report.js';
import { createReviewer, REVIEWER_NAMES, type ReviewerName } from './reviewers/index.js';
import { runEval, selectCases } from './runner.js';
import { computeMetrics } from './scoring/metrics.js';
import { DatasetSchema, type Dataset, type RunResult } from './types.js';

loadDotEnv();

function loadDataset(path = DATASET_PATH): Dataset {
  if (!existsSync(path)) throw new Error(`dataset not found at ${path}; run "npm run evals -- dataset build" first`);
  return DatasetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Default judge: Qwen on Groq, a different model family from both gpt-oss baselines (no self-grading). */
export const DEFAULT_JUDGE = { provider: 'groq' as ProviderName, model: 'qwen/qwen3.8-27b' };

function makeJudge(
  kind: string,
  cache: DiskCache,
  tolerance: number,
  over: { provider?: string; model?: string } = {},
): { judge: Judge; note?: string } {
  if (kind === 'keyword') return { judge: new KeywordJudge(0.25, tolerance) };
  const provider = (over.provider ?? process.env.EVALS_JUDGE_PROVIDER ?? DEFAULT_JUDGE.provider) as ProviderName;
  const model = over.model ?? process.env.EVALS_JUDGE_MODEL ?? (provider === DEFAULT_JUDGE.provider ? DEFAULT_JUDGE.model : undefined);
  const llm = providerFromEnv(provider, model);
  if (!llm) return { judge: new KeywordJudge(0.25, tolerance), note: 'No LLM key for the judge: fell back to keyword judge (much less accurate).' };
  return { judge: new LlmJudge(llm, cache, tolerance) };
}

const program = new Command().name('evals').description('Scoreboard for AI pull-request reviewers');

const dataset = program.command('dataset').description('build or inspect the dataset');
dataset
  .command('build')
  .description('mine bug-introducing PRs (SZZ over git history) + clean PRs')
  .option('--repos <list>', 'comma-separated owner/repo list', DEFAULT_REPOS.join(','))
  .option('--per-repo-buggy <n>', 'max buggy cases per repo', '8')
  .option('--per-repo-clean <n>', 'max clean cases per repo', '2')
  .option('--scan-limit <n>', 'max fix commits examined per repo', '250')
  .option('--max-intro-lines <n>', 'max changed lines in the introducing diff', '600')
  .option('--max-intro-files <n>', 'max files in the introducing diff', '20')
  .option('--extend', 'keep existing cases and add new ones', false)
  .option('--no-llm', 'skip LLM annotation (heuristic descriptions/categories)')
  .option('--annotator-model <id>', 'model for the preferred annotator provider')
  .option('--annotator <provider>', 'preferred provider (falls back to the other): groq | gemini', 'groq')
  .option('--out <path>', 'output file', DATASET_PATH)
  .action(async (o) => {
    const reposDir = resolve(process.env.EVALS_REPOS_DIR ?? join(CACHE_DIR, 'repos'));
    const llm = o.llm ? providerChainFromEnv(o.annotator as ProviderName, o.annotatorModel) : null;
    if (o.llm && !llm) console.warn('No LLM key: using heuristic annotation.');
    await buildDataset({
      repos: String(o.repos).split(',').map((s) => s.trim()).filter(Boolean),
      reposDir,
      out: resolve(o.out),
      perRepoBuggy: Number(o.perRepoBuggy),
      perRepoClean: Number(o.perRepoClean),
      scanLimit: Number(o.scanLimit),
      maxIntroLines: Number(o.maxIntroLines),
      maxIntroFiles: Number(o.maxIntroFiles),
      llm,
      cache: new DiskCache(join(CACHE_DIR, 'annotations')),
      extend: Boolean(o.extend),
    });
  });

dataset
  .command('stats')
  .description('print dataset composition')
  .option('--markdown', 'print markdown tables (for the README)')
  .action((o) => {
    const ds = loadDataset();
    const by = (f: (c: Dataset['cases'][number]) => string) => {
      const m = new Map<string, number>();
      for (const c of ds.cases) m.set(f(c), (m.get(f(c)) ?? 0) + 1);
      return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
    };
    if (o.markdown) {
      const buggy = ds.cases.filter((c) => c.kind === 'buggy');
      const repos = [...new Set(ds.cases.map((c) => c.repo))];
      const lines = ['| Repo | Buggy | Clean |', '|---|---|---|'];
      for (const r of repos) lines.push(`| ${r} | ${buggy.filter((c) => c.repo === r).length} | ${ds.cases.filter((c) => c.repo === r && c.kind === 'clean').length} |`);
      lines.push(`| **Total** | **${buggy.length}** | **${ds.cases.length - buggy.length}** |`, '', '| Category | Cases |', '|---|---|');
      for (const [k, v] of Object.entries(by((c) => c.bug?.category ?? '(clean)'))) if (k !== '(clean)') lines.push(`| ${k} | ${v} |`);
      const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
      lines.push('', `Median introducing diff: ${med(buggy.map((c) => c.diffStats.additions + c.diffStats.deletions))} changed lines in ${med(buggy.map((c) => c.diffStats.files))} files. Median SZZ share of blamed lines attributed to the introducer: ${(med(buggy.map((c) => c.bug!.szz.blamedLinesToIntroducer / c.bug!.szz.blamedLines)) * 100).toFixed(0)}%. Annotation: ${buggy.filter((c) => c.annotation?.by === 'llm').length} LLM, ${buggy.filter((c) => c.annotation?.by !== 'llm').length} heuristic.`);
      console.log(lines.join('\n'));
      return;
    }
    console.log(JSON.stringify({ source: ds.source, total: ds.cases.length, kind: by((c) => c.kind), repo: by((c) => c.repo), category: by((c) => c.bug?.category ?? '(clean)') }, null, 2));
  });

program
  .command('run')
  .description('run a reviewer over the dataset (or a subset) and judge it')
  .option('--reviewer <name>', `one of ${REVIEWER_NAMES.join(', ')}`, 'baseline')
  .option('--provider <name>', 'LLM provider for the baseline: gemini | groq')
  .option('--model <id>', 'model id override')
  .option('--judge <kind>', 'llm | keyword', 'llm')
  .option('--judge-provider <name>', 'judge LLM provider: groq | gemini')
  .option('--judge-model <id>', 'judge model id')
  .option('--until-done', 'keep resuming (waiting out daily quotas) until every case has a result', false)
  .option('--wait-minutes <n>', 'wait between resume passes', '20')
  .option('--max-hours <n>', 'give up after this long', '60')
  .option('--skip-judge', 'only produce and cache reviews; judge in a later run', false)
  .option('--tolerance <n>', 'line tolerance for location match', '5')
  .option('--limit <n>', 'evaluate only n cases (stratified, ~20% clean)')
  .option('--ids <list>', 'comma-separated case ids')
  .option('--kind <kind>', 'buggy | clean')
  .option('--concurrency <n>', 'parallel reviews', '1')
  .option('--no-cache', 're-run reviews even if cached')
  .option('--out <path>', 'results file (default results/<runId>.json)')
  .action(async (o) => {
    const ds = loadDataset();
    const cache = new DiskCache(join(CACHE_DIR, 'reviews'));
    const { reviewer, fallbackNote } = createReviewer(o.reviewer as ReviewerName, { provider: o.provider, model: o.model, chunkCache: new DiskCache(join(CACHE_DIR, 'chunks')) });
    const { judge, note: judgeNote } = makeJudge(o.judge, new DiskCache(join(CACHE_DIR, 'judge')), Number(o.tolerance), {
      provider: o.judgeProvider,
      model: o.judgeModel,
    });
    const cases = selectCases(ds.cases, { limit: o.limit ? Number(o.limit) : undefined, ids: o.ids ? String(o.ids).split(',') : undefined, kind: o.kind });
    const notes = [fallbackNote, judgeNote].filter((x): x is string => Boolean(x));
    for (const n of notes) console.warn(`! ${n}`);
    console.log(`Reviewer ${reviewer.id} · judge ${judge.id} · ${cases.length} cases`);
    mkdirSync(RESULTS_DIR, { recursive: true });
    const outPath = o.out ? resolve(o.out) : undefined;
    const deadline = Date.now() + Number(o.maxHours) * 3_600_000;
    let previous: RunResult | undefined = outPath && existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as RunResult) : undefined;
    if (previous) console.log(`Resuming from ${outPath} (${previous.results.filter((r) => !r.review.error).length} results reused)`);
    let run: RunResult;
    let errorPasses = 0;
    for (let pass = 1; ; pass++) {
      run = await runEval({
        reviewer,
        judge,
        cases,
        cache,
        datasetVersion: ds.version,
        concurrency: Number(o.concurrency),
        noCache: o.cache === false && pass === 1 && !previous,
        skipJudge: Boolean(o.skipJudge),
        previous,
        notes,
        onProgress: (d, t, r) =>
          console.log(
            `  [${d}/${t}] ${r.caseId} ${r.kind} comments=${r.review.comments.length}${r.verdict ? ` caught=${r.verdict.caught}` : ''}${r.cached ? ' (cached)' : ''}${r.review.error ? ` ERROR ${r.review.error.slice(0, 100)}` : ''}`,
          ),
      });
      const out = outPath ?? join(RESULTS_DIR, `${run.runId}.json`);
      writeFileSync(out, JSON.stringify(run, null, 2) + '\n');
      const errors = run.results.filter((r) => r.review.error).length;
      const pending = run.pending?.length ?? 0;
      console.log(`pass ${pass}: ${run.results.length - errors} ok, ${errors} errors, ${pending} pending -> ${out}`);
      if (!o.untilDone) break;
      if (pending === 0 && (errors === 0 || ++errorPasses >= 3)) break;
      if (Date.now() > deadline) {
        console.log('! max-hours reached; stopping with work left');
        break;
      }
      previous = run;
      const waitMs = pending > 0 ? Number(o.waitMinutes) * 60_000 : 60_000;
      console.log(`waiting ${Math.round(waitMs / 60_000)} min before resuming (until ${new Date(Date.now() + waitMs).toISOString()})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    const m = computeMetrics(run.results);
    console.log(`\nCatch rate ${m.catchRate.num}/${m.catchRate.den} · comments/clean PR ${m.noise.commentsPerCleanPr?.toFixed(2) ?? '–'} · cost $${m.cost.totalUsd.toFixed(4)} · p50 ${m.latencyMs.p50 ?? '–'}ms`);
    if (run.pending?.length) console.log(`! ${run.pending.length} cases pending (daily quota). Re-run the same command later to resume.`);
  });

const judgeCmd = program.command('judge').description('judge utilities');
judgeCmd
  .command('validate')
  .description('compare the judge with hand labels in dataset/judge-labels.json')
  .option('--judge <kind>', 'llm | keyword', 'llm')
  .option('--judge-provider <name>', 'judge LLM provider: groq | gemini')
  .option('--judge-model <id>', 'judge model id')
  .option('--labels <path>', 'labels file', LABELS_PATH)
  .option('--out <path>', 'output file', join(RESULTS_DIR, 'judge-validation.json'))
  .action(async (o) => {
    const ds = loadDataset();
    const { judge, note } = makeJudge(o.judge, new DiskCache(join(CACHE_DIR, 'judge')), 5, { provider: o.judgeProvider, model: o.judgeModel });
    if (note) console.warn(`! ${note}`);
    const res = await validateJudge(judge, loadLabels(resolve(o.labels)), ds.cases);
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(resolve(o.out), JSON.stringify(res, null, 2) + '\n');
    console.log(`Judge ${res.judgeId}: accuracy ${((res.agreement.accuracy ?? 0) * 100).toFixed(1)}% on ${res.agreement.n} items, kappa ${res.agreement.kappa?.toFixed(2)}`);
    for (const d of res.disagreements) console.log(`  disagree ${d.id}: label=${d.human} judge=${d.judge}`);
  });

program
  .command('report')
  .description('render markdown + HTML scoreboard from one or more result files')
  .option('--runs <list>', 'comma-separated result files (default: all in results/)')
  .option('--judge-validation <path>', 'judge validation file', join(RESULTS_DIR, 'judge-validation.json'))
  .option('--title <title>', 'report title', 'AI PR Reviewer Scoreboard')
  .option('--out <base>', 'output path without extension', join(REPORTS_DIR, 'scoreboard'))
  .action((o) => {
    const ds = loadDataset();
    const files: string[] = o.runs
      ? String(o.runs).split(',').map((p) => resolve(p))
      : readdirSync(RESULTS_DIR)
          .filter((f) => f.endsWith('.json') && !f.startsWith('judge-validation') && f !== basename(o.judgeValidation))
          .map((f) => join(RESULTS_DIR, f));
    const runs = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as RunResult);
    const jv = existsSync(o.judgeValidation) ? (JSON.parse(readFileSync(o.judgeValidation, 'utf8')) as JudgeValidation) : undefined;
    const input = { title: o.title, runs, dataset: ds, judgeValidation: jv };
    const base = resolve(o.out);
    mkdirSync(resolve(base, '..'), { recursive: true });
    writeFileSync(`${base}.md`, renderMarkdown(input));
    writeFileSync(`${base}.html`, renderHtml(input));
    console.log(`Wrote ${base}.md and ${base}.html (${runs.length} runs) [root ${ROOT}]`);
  });

program.parseAsync().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
