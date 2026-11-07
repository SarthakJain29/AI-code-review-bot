/** Markdown + static HTML scoreboard. Pure functions of (runs, dataset, judge validation). */
import type { Agreement, Metrics, Rate } from '../scoring/metrics.js';
import { computeMetrics } from '../scoring/metrics.js';
import type { Dataset, RunResult } from '../types.js';

export interface JudgeValidation {
  judgeId: string;
  agreement: Agreement;
  disagreements: { id: string; human: boolean; judge: boolean; note: string }[];
}

export interface ReportInput {
  title: string;
  runs: RunResult[];
  dataset: Dataset;
  judgeValidation?: JudgeValidation;
  generatedAt?: string;
}

const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)}%`);
const rateStr = (r: Rate) => (r.value === null ? '–' : `${pct(r.value)} (${r.num}/${r.den})`);
const ciStr = (r: Rate) => (r.ci ? `${pct(r.ci[0])}–${pct(r.ci[1])}` : '–');
const num = (v: number | null, d = 2) => (v === null ? '–' : v.toFixed(d));
const usd = (v: number | null) => (v === null ? '–' : `$${v < 0.01 ? v.toFixed(5) : v.toFixed(3)}`);
const ms = (v: number | null) => (v === null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

interface Row {
  run: RunResult;
  m: Metrics;
}

function rows(runs: RunResult[]): Row[] {
  return runs.map((run) => ({ run, m: computeMetrics(run.results) }));
}

function datasetSummary(ds: Dataset) {
  const buggy = ds.cases.filter((c) => c.kind === 'buggy');
  const repos = new Set(ds.cases.map((c) => c.repo));
  const cats = new Map<string, number>();
  for (const c of buggy) cats.set(c.bug!.category, (cats.get(c.bug!.category) ?? 0) + 1);
  return { total: ds.cases.length, buggy: buggy.length, clean: ds.cases.length - buggy.length, repos: repos.size, cats };
}

export function renderMarkdown(input: ReportInput): string {
  const rs = rows(input.runs);
  const ds = datasetSummary(input.dataset);
  const L: string[] = [];
  L.push(`# ${input.title}`, '');
  L.push(`Generated ${input.generatedAt ?? new Date().toISOString()} · dataset v${input.dataset.version}: ${ds.total} cases (${ds.buggy} buggy, ${ds.clean} clean) from ${ds.repos} repos · source: ${input.dataset.source}`, '');
  const sample = rs.some((r) => r.run.caseCount < ds.total);
  if (sample) L.push(`> **Sample run** — only a subset of the dataset was evaluated. Numbers have very wide error bars and are NOT a benchmark result.`, '');
  for (const { run } of rs)
    if (run.pending?.length) L.push(`> **Incomplete:** \`${run.reviewerId}\` has ${run.pending.length} cases pending (provider daily quota). Re-run to resume.`, '');
  L.push('## Scoreboard', '');
  L.push('| Reviewer | Catch rate (strict) | 95% CI | Catch rate (bug file, any line) | Comments / clean PR | Silent on clean | Precision ≥ | Cost / review | Latency p50 / p95 | Errors |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const { run, m } of rs)
    L.push(
      `| \`${run.reviewerId}\` | ${rateStr(m.catchRate)} | ${ciStr(m.catchRate)} | ${rateStr(m.catchRateAnyLocation)} | ${num(m.noise.commentsPerCleanPr)} | ${rateStr(m.noise.silentOnClean)} | ${rateStr(m.precisionLowerBound)} | ${usd(m.cost.perReviewUsd)} | ${ms(m.latencyMs.p50)} / ${ms(m.latencyMs.p95)} | ${m.cases.errored} |`,
    );
  L.push('', 'Definitions: see `evals/README.md#metrics`. Cost is a list-price equivalent (free tiers cost $0).', '');

  const cats = [...new Set(rs.flatMap((r) => r.m.byCategory.map((c) => c.category)))];
  if (cats.length) {
    L.push('## Catch rate by bug category', '');
    L.push(`| Category | ${rs.map((r) => `\`${r.run.reviewerId}\``).join(' | ')} |`);
    L.push(`|---|${rs.map(() => '---').join('|')}|`);
    for (const cat of cats) L.push(`| ${cat} | ${rs.map((r) => {
      const c = r.m.byCategory.find((x) => x.category === cat);
      return c ? rateStr(c.catchRate) : '–';
    }).join(' | ')} |`);
    L.push('');
  }

  if (input.judgeValidation) {
    const { agreement: a, judgeId, disagreements } = input.judgeValidation;
    L.push('## Judge validation', '');
    L.push(`Judge \`${judgeId}\` vs hand labels on ${a.n} (case, comments) items: **accuracy ${pct(a.accuracy)}**, Cohen's κ ${num(a.kappa)}.`, '');
    L.push(`Confusion (judge vs label): TP ${a.confusion.tp} · FP ${a.confusion.fp} · FN ${a.confusion.fn} · TN ${a.confusion.tn}`, '');
    if (disagreements.length) {
      L.push('Disagreements:', '');
      for (const d of disagreements) L.push(`- \`${d.id}\`: label=${d.human ? 'caught' : 'missed'}, judge=${d.judge ? 'caught' : 'missed'} — ${d.note}`);
      L.push('');
    }
  }

  L.push('## Per-case results', '');
  for (const { run } of rs) {
    L.push(`### \`${run.reviewerId}\``, '');
    L.push('| Case | Kind | Category | Comments | Caught (strict / bug file) | Notes |', '|---|---|---|---|---|---|');
    for (const r of run.results) {
      const c = input.dataset.cases.find((x) => x.id === r.caseId);
      const link = c?.pr.url ? `[${r.caseId}](${c.pr.url})` : r.caseId;
      const caught = r.kind === 'buggy' ? `${r.verdict?.caught ? '✅' : '❌'} / ${r.verdict?.caughtAnyLocation ? '✅' : '❌'}` : '–';
      L.push(`| ${link} | ${r.kind} | ${r.category ?? '–'} | ${r.review.comments.length} | ${caught} | ${r.review.error ? `error: ${r.review.error.slice(0, 80).replace(/\|/g, '/')}` : r.cached ? 'cached' : ''} |`);
    }
    L.push('');
  }
  if (rs.some((r) => r.run.notes.length)) {
    L.push('## Run notes', '');
    for (const { run } of rs) for (const n of run.notes) L.push(`- \`${run.reviewerId}\`: ${n}`);
    L.push('');
  }
  return L.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function bar(r: Rate): string {
  const v = r.value ?? 0;
  const ci = r.ci ?? [0, 0];
  return `<div class="bar" title="95% CI ${esc(ciStr(r))}"><div class="ci" style="left:${ci[0] * 100}%;width:${(ci[1] - ci[0]) * 100}%"></div><div class="fill" style="width:${v * 100}%"></div></div>`;
}

export function renderHtml(input: ReportInput): string {
  const rs = rows(input.runs);
  const ds = datasetSummary(input.dataset);
  const sample = rs.some((r) => r.run.caseCount < ds.total);
  const scoreRows = rs
    .map(
      ({ run, m }) => `<tr>
<td><code>${esc(run.reviewerId)}</code></td>
<td class="num"><strong>${esc(rateStr(m.catchRate))}</strong>${bar(m.catchRate)}</td>
<td class="num">${esc(rateStr(m.catchRateAnyLocation))}</td>
<td class="num">${esc(num(m.noise.commentsPerCleanPr))}</td>
<td class="num">${esc(rateStr(m.noise.silentOnClean))}</td>
<td class="num">${esc(rateStr(m.precisionLowerBound))}</td>
<td class="num">${esc(usd(m.cost.perReviewUsd))}</td>
<td class="num">${esc(ms(m.latencyMs.p50))} / ${esc(ms(m.latencyMs.p95))}</td>
<td class="num">${m.cases.errored}</td></tr>`,
    )
    .join('\n');

  const cats = [...new Set(rs.flatMap((r) => r.m.byCategory.map((c) => c.category)))];
  const catRows = cats
    .map(
      (cat) =>
        `<tr><td>${esc(cat)}</td>${rs
          .map((r) => {
            const c = r.m.byCategory.find((x) => x.category === cat);
            return `<td class="num">${c ? esc(rateStr(c.catchRate)) + bar(c.catchRate) : '–'}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('\n');

  const caseBlocks = rs
    .map(({ run }) => {
      const items = run.results
        .map((r) => {
          const c = input.dataset.cases.find((x) => x.id === r.caseId);
          const status = r.kind === 'clean' ? (r.review.comments.length ? 'noisy' : 'quiet') : r.verdict?.caught ? 'caught' : r.verdict?.caughtAnyLocation ? 'near' : 'missed';
          const comments = r.review.comments
            .map((cm, i) => {
              const v = r.verdict?.perComment.find((p) => p.index === i);
              const tag = v ? `${v.semanticMatch ? 'semantic✓' : 'semantic✗'} ${v.locationMatch ? 'location✓' : 'location✗'}` : '';
              return `<li><code>${esc(cm.file)}:${cm.line}</code> <span class="sev ${cm.severity}">${cm.severity}</span> ${esc(cm.body)} ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}${v?.reason ? `<div class="reason">judge: ${esc(v.reason)}</div>` : ''}</li>`;
            })
            .join('');
          const bug = c?.bug
            ? `<p><strong>Known bug</strong> (${esc(c.bug.category)}) at ${c.bug.locations.map((l) => `<code>${esc(l.file)}:${l.lines.start}-${l.lines.end}</code>`).join(', ')}: ${esc(c.bug.description)}<br>Fixed by ${c.bug.fixPr.url ? `<a href="${esc(c.bug.fixPr.url)}">${esc(c.bug.fixPr.title)}</a>` : esc(c.bug.fixPr.title)}</p>`
            : '<p>Clean PR (no known bug): every comment counts as noise.</p>';
          return `<details><summary><span class="status ${status}">${status}</span> ${esc(r.caseId)} · ${esc(c?.pr.title ?? '')} · ${r.review.comments.length} comments${r.review.error ? ' · <em>error</em>' : ''}</summary>
<p>${c?.pr.url ? `<a href="${esc(c.pr.url)}">${esc(c.pr.url)}</a>` : ''} · +${c?.diffStats.additions ?? 0}/−${c?.diffStats.deletions ?? 0} in ${c?.diffStats.files ?? 0} files</p>
${bug}${r.review.error ? `<p class="err">${esc(r.review.error)}</p>` : ''}<ul>${comments || '<li><em>no comments</em></li>'}</ul></details>`;
        })
        .join('\n');
      return `<h3><code>${esc(run.reviewerId)}</code></h3>${items}`;
    })
    .join('\n');

  const jv = input.judgeValidation;
  const judgeHtml = jv
    ? `<section><h2>Judge validation</h2><p>Judge <code>${esc(jv.judgeId)}</code> vs hand labels on ${jv.agreement.n} items:
<strong>accuracy ${esc(pct(jv.agreement.accuracy))}</strong>, Cohen's κ ${esc(num(jv.agreement.kappa))}.
TP ${jv.agreement.confusion.tp} · FP ${jv.agreement.confusion.fp} · FN ${jv.agreement.confusion.fn} · TN ${jv.agreement.confusion.tn}</p>
${jv.disagreements.length ? `<ul>${jv.disagreements.map((d) => `<li><code>${esc(d.id)}</code>: label=${d.human ? 'caught' : 'missed'}, judge=${d.judge ? 'caught' : 'missed'} — ${esc(d.note)}</li>`).join('')}</ul>` : ''}</section>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reviewer Scoreboard</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e0;--card:#fff;--accent:#2f6fde;--ci:#c9d8f5;--ok:#1f8a4c;--bad:#c0392b;--warn:#b7791f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141416;--fg:#ececee;--muted:#9a9aa2;--line:#2c2c31;--card:#1c1c20;--accent:#6c9cf0;--ci:#2a3b5c;--ok:#4cc38a;--bad:#ef6b5b;--warn:#e0a84a}}
:root[data-theme="dark"]{--bg:#141416;--fg:#ececee;--muted:#9a9aa2;--line:#2c2c31;--card:#1c1c20;--accent:#6c9cf0;--ci:#2a3b5c;--ok:#4cc38a;--bad:#ef6b5b;--warn:#e0a84a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px}h3{font-size:16px}
.meta{color:var(--muted);font-size:13px}.warn{border-left:3px solid var(--warn);padding:8px 12px;background:var(--card);margin:16px 0}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap}.bar{position:relative;height:6px;background:var(--line);border-radius:3px;margin-top:4px;min-width:90px}
.bar .ci{position:absolute;top:0;height:6px;background:var(--ci);border-radius:3px}.bar .fill{position:absolute;top:1px;height:4px;background:var(--accent);border-radius:2px}
details{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:6px 0}summary{cursor:pointer}
.status{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;border:1px solid currentColor}
.status.caught,.status.quiet{color:var(--ok)}.status.missed,.status.noisy{color:var(--bad)}.status.near{color:var(--warn)}
.sev{font-size:11px;text-transform:uppercase;color:var(--muted)}.sev.critical,.sev.major{color:var(--bad)}.tag{font-size:11px;color:var(--muted)}
.reason{font-size:12px;color:var(--muted)}.err{color:var(--bad)}code{font-size:13px;overflow-wrap:anywhere}a{color:var(--accent)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;font-size:14px}dt{font-weight:600}dd{margin:0;color:var(--muted)}
</style></head><body><main>
<h1>${esc(input.title)}</h1>
<p class="meta">Generated ${esc(input.generatedAt ?? new Date().toISOString())} · dataset v${input.dataset.version}: ${ds.total} cases (${ds.buggy} buggy, ${ds.clean} clean) from ${ds.repos} repos · ${esc(input.dataset.source)}</p>
${sample ? '<p class="warn"><strong>Sample run.</strong> Only a subset of the dataset was evaluated; error bars are very wide and this is not a benchmark result.</p>' : ''}
${rs.filter((r) => r.run.pending?.length).map((r) => `<p class="warn"><strong>Incomplete:</strong> <code>${esc(r.run.reviewerId)}</code> has ${r.run.pending!.length} cases pending (provider daily quota).</p>`).join('')}
<section><h2>Scoreboard</h2><div class="scroll"><table>
<thead><tr><th>Reviewer</th><th>Catch rate (strict)</th><th>Bug file, any line</th><th>Comments / clean PR</th><th>Silent on clean</th><th>Precision ≥</th><th>Cost / review</th><th>Latency p50 / p95</th><th>Errors</th></tr></thead>
<tbody>${scoreRows}</tbody></table></div>
<dl style="margin-top:12px"><dt>Catch rate</dt><dd>Buggy PRs where a comment matches the known bug semantically (LLM judge) and lands within ±5 lines of it. Bar shows value and 95% Wilson CI.</dd>
<dt>Bug file, any line</dt><dd>Semantic match in a file the bug is in, line ignored.</dd><dt>Comments / clean PR</dt><dd>Mean comments on PRs with no known bug (presumed false positives).</dd>
<dt>Precision ≥</dt><dd>Comments matching the known bug ÷ all comments on buggy PRs. A lower bound: other comments may be valid.</dd>
<dt>Cost</dt><dd>List-price equivalent from token counts; free tiers bill $0.</dd></dl></section>
${cats.length ? `<section><h2>Catch rate by bug category</h2><div class="scroll"><table><thead><tr><th>Category</th>${rs.map((r) => `<th><code>${esc(r.run.reviewerId)}</code></th>`).join('')}</tr></thead><tbody>${catRows}</tbody></table></div></section>` : ''}
${judgeHtml}
<section><h2>Per-case results</h2>${caseBlocks}</section>
</main></body></html>
`;
}
