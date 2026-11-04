# Diffwise Evals: a scoreboard for AI pull-request reviewers

**How many real bugs does a reviewer catch, how much noise does it make, and what does it cost?**

This folder is a self-contained evaluation harness for AI code reviewers. It replays **real bug-introducing pull
requests** from popular open-source TypeScript/JavaScript repos and checks whether the reviewer flags the bug
that was later fixed upstream. It also replays **clean PRs** to measure false positives. Every run produces a
scoreboard in Markdown and HTML.

It was built before the Diffwise bot itself (GitHub App → webhook → queue → worker → LLM → PR comments) was
finished, so it is fully decoupled: any reviewer that maps `diff → comments` can be scored. A single-prompt LLM
**baseline** is included so Diffwise has something concrete to beat.

```
 dataset/cases.json ──► Reviewer.review(diff) ──► comments[{file,line,body,severity}]
   (SZZ-mined bugs                                           │
    + clean PRs)                                             ▼
                                 Judge: location (±5 lines) + LLM semantic match
                                                             │
                                                             ▼
             metrics (catch rate, noise, precision bound, cost, latency, by category)
                                                             │
                                                             ▼
                                   reports/scoreboard.{md,html}
```

> **Status:** the harness, dataset and judge are complete. Per the brief, the **full eval has not been run**. The
> committed report in [`reports/`](reports/) is a **5-case smoke test**, and its numbers carry error bars far
> too wide to mean anything. Run the full eval with `npm run evals -- run --reviewer baseline`.

---

## Contents

- [Quick start](#quick-start)
- [Methodology](#methodology)
- [Dataset construction](#dataset-construction)
- [The judge and how it was validated](#judge-validation)
- [Metrics](#metrics)
- [Plugging in Diffwise](#plugging-in-diffwise)
- [Limitations](#limitations)

## Quick start

```bash
cd evals
npm install
cp .env.example .env          # GEMINI_API_KEY and/or GROQ_API_KEY (free tiers)
npm run check                 # typecheck + lint + unit tests

npm run evals -- dataset stats
npm run evals -- run --reviewer baseline --limit 5     # smoke test
npm run evals -- judge validate                        # judge vs hand labels
npm run evals -- report                                # -> reports/scoreboard.md / .html
```

With no API keys, everything still runs end to end: the baseline becomes a deterministic heuristic mock and
the judge becomes a keyword matcher. The run notes say so, and those numbers are only plumbing checks.
Setup details, env vars and troubleshooting are in [developer.md](developer.md).

## Methodology

The question is: *if this reviewer had reviewed the PR that introduced a bug, would it have flagged that bug?*

1. **Ground truth comes from history.** A bug is "known" when maintainers later merged a fix for it. The PR
   that introduced it is found with SZZ (blame the lines the fix changed). The reviewer sees only the
   introducing PR's diff, as a human reviewer would have.
2. **The reviewer is a black box.** `review({diff, repo, title}) → {comments, usage}`. There is no repo checkout
   and no network beyond the reviewer's own LLM. Tools or context retrieval would sit inside the reviewer.
3. **A comment catches the bug** only when it points at the bug (same file, within ±5 lines of the blamed lines)
   **and** describes the same defect, as decided by an LLM judge that sees the bug description and the real fix.
4. **Noise is measured on clean PRs.** These are merged feature/refactor PRs with no known bug, and every comment
   on them is treated as a false positive.
5. **Everything is cached and versioned.** Reviewer ids include the model and the prompt version, and cache keys
   include the diff, so changing the prompt never reuses stale results. Re-rendering a report costs nothing.

## Dataset construction

`npm run evals -- dataset build` regenerates [`dataset/cases.json`](dataset/cases.json). Add `--extend --repos a/b`
to add repos without rebuilding. Code: [`src/dataset/`](src/dataset).

**Repos (12):** vuejs/core, sveltejs/svelte, vitest-dev/vitest, TanStack/query, honojs/hono, colinhacks/zod,
axios/axios, date-fns/date-fns, pmndrs/zustand, immerjs/immer, sindresorhus/ky, unjs/h3. All are popular,
TS/JS, and squash-merge PRs with conventional-commit titles such as `fix(scope): … (#1234)`. That gives a merged PR
number on every commit of the main branch.

**Pipeline (SZZ-style):**

| Step | Rule | Why |
|---|---|---|
| 1. Fix PRs | first-parent commits titled `fix…: … (#N)`; drop titles about types, docs, deps, tests, build, lint, typos, reverts | merged bug-fix PRs only, and runtime logic only |
| 2. Fix size | ≤ 3 source files, ≤ 60 changed source lines, ≥ 1 deleted/modified non-trivial line | small, targeted fixes have a clear bug location; pure additions can't be blamed |
| 3. Blame | `git blame -w -M` on the fix's parent for every deleted/modified source line, ignoring blank, brace-only and comment lines | finds the commit that last wrote the buggy lines |
| 4. Introducer | majority vote (≥ 50% of blamed lines); must be a single-parent squash commit with a PR number, not mechanical (format, rename, release, bump), older than the fix | standard SZZ refinements that reduce misattribution |
| 5. Reviewable | introducing diff ≤ 600 changed lines and ≤ 20 files, after dropping lockfiles, snapshots, build output and binaries | a reviewer could plausibly read it |
| 6. Location | blamed lines that are **added** lines of the introducing diff, merged into ranges (gaps ≤ 3) | location in the reviewer's own coordinates (new-side line numbers) |
| 7. Annotation | an LLM (Groq `gpt-oss-120b` or `gpt-oss-20b`, depending on the repo; see developer.md) reads the fix commit, fix diff and blamed lines. It **rejects** non-logic or misattributed pairs and writes a 1–2 sentence description of what is wrong *in the introducing code*, plus a category | filters SZZ noise; gives the judge a target |
| 8. Clean PRs | `feat/perf/refactor (#N)` PRs ≥ 270 days old, 15–400 changed lines, never reverted, and no later fix touching their files blames back to them (up to 15 checked) | "no known bug" after a long exposure window |

Each case stores: repo, introducing PR (number, commit, title, URL, date), the filtered unified diff, diff stats,
bug locations (file + inclusive line range), the fix PR and its diff, the description, the category, SZZ
statistics (blamed lines, share attributed to the introducer, number of candidate commits) and who annotated it.
The schema is in [`src/types.ts`](src/types.ts).

**Categories:** `logic`, `null-undefined`, `edge-case`, `async-concurrency`, `type-coercion`, `api-contract`,
`state-mutation`, `regex-string`, `performance`, `other`.

**Why not the GitHub REST API, or SWE-bench?** The brief asked for the GitHub REST API (with
`EVALS_GITHUB_TOKEN`), with SWE-PolyBench or SWE-bench Multilingual as the fallback. In the sandbox where this was
built, the API was blocked for repos outside the session (proxy 403), but plain `git clone` of public repos worked.
Squash-merge titles carry the PR number, so the same thing can be done from history alone: real merged fix PRs
and real `git blame`. That is closer to the brief than SWE-style datasets, which have issues and fix patches but no
bug-introducing PR to review. The builder still probes the REST API first and uses PR metadata when it is reachable.

<!-- DATASET-STATS -->

## Judge validation

**How the judge works** ([`src/judge/judge.ts`](src/judge/judge.ts)):

- **Location check (deterministic):** the comment's file matches a bug file (path-normalised) and its line is
  within the bug range ±5 (`--tolerance`).
- **Semantic check (LLM):** Groq `openai/gpt-oss-120b` at temperature 0 gets the bug description, category,
  location, the real fix diff (source files first) and all comments. It returns `match` and a reason for each
  comment. The prompt is strict: generic advice ("add tests", "check for null" without this bug's cause) and
  different real problems in the same lines do not count. The judge deliberately uses a different model family
  from the baseline reviewer (Gemini `gemini-3.1-flash-lite`), to avoid self-preference.
- **Verdicts:** `caught` = some comment passes both checks; `caughtAnyLocation` = some comment passes the semantic check.
- Offline fallback: a keyword-overlap judge. It is much weaker and only for plumbing tests.

**Validation:** [`dataset/judge-labels.json`](dataset/judge-labels.json) holds hand-labelled items, each a
(buggy case, comment set, *caught?*) triple. They include the real baseline comments from the smoke run, plus
comment sets written to probe the judge's hard cases:

- a correct comment paraphrased with none of the description's words;
- the right bug, pointed at the wrong line (should be "missed" under strict scoring);
- the right lines, but a different issue;
- generic advice placed exactly on the bug;
- several plausible comments where only one is the real bug.

`npm run evals -- judge validate` reports accuracy and Cohen's κ against the labels.

<!-- JUDGE-STATS -->

## Metrics

All metrics are computed in [`src/scoring/metrics.ts`](src/scoring/metrics.ts) and unit-tested.

| Metric | Definition | Notes |
|---|---|---|
| **Catch rate (strict)** — headline recall | buggy PRs where ≥ 1 comment is a semantic match **and** within ±5 lines of the bug ÷ buggy PRs | 95% Wilson interval shown; at n≈70 expect about ±11 points |
| Catch rate (any line) | same, ignoring location | the gap to strict = "found it, pointed at the wrong line" |
| **Comments / clean PR** — noise | mean comments on clean PRs | every comment on a clean PR is presumed a false positive (some may be valid) |
| Serious comments / clean PR | same, counting only `critical`/`major` | the noise that would block a merge |
| Silent on clean | share of clean PRs with zero comments | |
| Precision ≥ | comments matching the known bug ÷ all comments on buggy PRs | a **lower bound**: other comments may flag real issues the dataset doesn't know about |
| Serious-alert precision | PRs with any `critical`/`major` comment that are buggy ÷ all such PRs | depends on the buggy:clean mix (~3.5:1 here), so compare reviewers only on the same dataset |
| Cost / review | (input tokens × input price + output tokens × output price) / reviews | **list-price equivalent** from [`src/llm/pricing.ts`](src/llm/pricing.ts); free tiers bill $0; thinking tokens count as output |
| Latency p50 / p95 | wall-clock time per review call, errored calls excluded | cached results keep their original latency |
| By category | strict catch rate per bug category | small n per category: read as directional only |
| Errors | reviews that failed after retries | they count as "no comments" (a miss) and are never cached |

## Plugging in Diffwise

The harness needs one function: diff in, comments out.

```ts
// src/types.ts
interface Reviewer {
  readonly id: string;                        // change it whenever model/prompt changes (cache key)
  review(input: { diff: string; repo: string; title: string }): Promise<{
    comments: { file: string; line: number; body: string; severity: 'critical'|'major'|'minor'|'nit' }[];
    usage: { inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number; model: string };
    error?: string;
  }>;
}
```

There are two ways to connect it, both sketched in [`src/reviewers/diffwise.ts`](src/reviewers/diffwise.ts):

1. **In-process (recommended).** When the bot's worker has its review step as a pure function (for example
   `reviewDiff({diff, repo, title})`, separate from fetching the diff and posting comments), import it into
   `DiffwiseReviewer.review()`. This scores the review logic without GitHub, Redis or the queue.
2. **Over HTTP.** Expose an eval-only endpoint `POST {diff, repo, title} → {comments, usage}`, then:
   ```bash
   DIFFWISE_REVIEW_URL=http://localhost:3000/internal/review DIFFWISE_VERSION=v0.3 \
     npm run evals -- run --reviewer diffwise
   npm run evals -- report --runs results/<baseline>.json,results/<diffwise>.json
   ```

`line` must be a **new-side** line number in the diff, the same number GitHub's review-comment API takes as
`line` with `side: RIGHT`. A bot that posts correctly to GitHub is already using these coordinates. Bump
`DIFFWISE_VERSION` (and so the reviewer id) whenever the prompt or model changes, so the cache doesn't serve
old reviews.

**Comparing fairly:** use the same dataset version and the same judge, and compare the strict catch rate *together
with* noise on clean PRs. A reviewer can trivially raise recall by commenting on every line. If Diffwise adds repo
context such as embeddings, note that the baseline sees the diff only.

## Limitations

- **SZZ is noisy.** Blame finds who last touched a line, not who introduced the defect. Refactors, moved code and
  bugs caused by *missing* code (the fix only adds lines) are misattributed or dropped. Majority voting,
  whitespace-insensitive blame, mechanical-commit filters and the LLM's reject step reduce this but don't remove it.
  Spot-check cases before quoting results.
- **"Clean" means "no known bug".** Clean PRs may contain bugs nobody reported, so noise is an upper bound on
  false positives and the precision figure is a lower bound.
- **Some bugs need context the diff doesn't have** (other files, runtime behaviour, framework internals; Vue's
  Suspense/Transition cases are like this). A diff-only reviewer has a hard ceiling here, which is the case for
  repo context in Diffwise.
- **LLM-annotated descriptions and an LLM judge.** Both can be wrong. The judge is validated against hand labels,
  but the label set is small and was made by the harness author during development (an AI agent working
  unattended), so a human should re-check it. Some validation items are constructed probes, not real
  reviewer output.
- **Small n.** About 70 buggy cases give a ±10–12 point confidence interval on recall. Differences between
  reviewers smaller than that are not significant. Per-category numbers are directional only.
- **Selection bias.** Only squash-merge repos with conventional commits, small fixes and ≤600-line PRs are included.
  Large PRs, where review is hardest, are under-represented.
- **Data contamination.** These are public repos, so the reviewer's model may have seen the fix during training.
  This affects all LLM reviewers roughly equally, but it inflates absolute numbers.
- **Free-tier volatility.** Gemini free-tier models get rotated or retired (`gemini-2.5-flash` was unavailable to new keys; `gemini-3.5-flash` allows 20 requests/day on the free tier, which is why the baseline uses `gemini-3.1-flash-lite`)
  and return 503s under load. Latency numbers include provider queueing.
- **Cost is an estimate** at list prices, some of which are marked `assumed` in `pricing.ts`.
