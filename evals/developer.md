# evals/ — developer notes

Working notes for the evaluation harness. The showcase/methodology doc is [README.md](README.md).
The evals package is fully independent of the Diffwise bot code (nothing outside `evals/` was changed).

## Setup

```bash
cd evals
npm install
cp .env.example .env   # then fill in the keys you have
npm run check          # typecheck + lint + tests
```

Requirements: Node ≥ 20 (developed on 22), git on PATH (the dataset builder clones repos and runs `git blame`).

## Environment variables / credentials

| Variable | Needed for | Where to get it | If missing |
|---|---|---|---|
| `GEMINI_API_KEY` | baseline reviewer (default), annotation fallback | https://aistudio.google.com/apikey (free tier) | falls back to Groq, then mock |
| `GROQ_API_KEY` | LLM judge (default), dataset annotation (default) | https://console.groq.com/keys (free tier) | falls back to Gemini, then keyword judge / heuristic annotation |
| `EVALS_GITHUB_TOKEN` | optional PR metadata (title/body) via GitHub REST while building the dataset | https://github.com/settings/tokens (fine-grained, public repos read-only, no scopes needed) | builder works from git history only |
| `EVALS_REVIEWER_PROVIDER` / `EVALS_REVIEWER_MODEL` | override baseline model (default `gemini` / `gemini-3.5-flash`) | – | defaults |
| `EVALS_JUDGE_PROVIDER` / `EVALS_JUDGE_MODEL` | override judge (default `groq` / `openai/gpt-oss-120b`) | – | defaults |
| `EVALS_REPOS_DIR` | where the builder clones repos (default `.cache/repos`, ~550 MB for the default list) | – | default |
| `DIFFWISE_REVIEW_URL` / `DIFFWISE_VERSION` | `--reviewer diffwise` HTTP adapter (future) | your local Diffwise | diffwise reviewer becomes `mock-silent` with a note |

`GITHUB_TOKEN` / `GH_TOKEN` are deliberately **not** read by evals (reserved for pushing this repo).
Never commit `.env`; `evals/.gitignore` and the root `.gitignore` both exclude it.

## How to run

```bash
npm run evals -- dataset build                 # regenerate dataset/cases.json (≈20–40 min, mostly LLM annotation)
npm run evals -- dataset build --extend --repos owner/repo,owner/repo2   # add repos to the existing dataset
npm run evals -- dataset build --no-llm        # offline: heuristic descriptions/categories
npm run evals -- dataset stats

npm run evals -- run --reviewer baseline --limit 5      # smoke test (stratified subset)
npm run evals -- run --reviewer baseline                # FULL run (~90 reviews + ~70 judge calls)
npm run evals -- run --reviewer mock --judge keyword    # fully offline, no keys
npm run evals -- judge validate                         # judge vs hand labels -> results/judge-validation.json
npm run evals -- report --runs results/a.json,results/b.json --out reports/scoreboard
```

All reviews and judge verdicts are cached in `.cache/` keyed by (reviewer id incl. model + prompt version, case, diff),
so re-running `run` or `report` is free. Use `--no-cache` to force fresh reviews.

### Running inside the Claude Code cloud sandbox
Node's built-in `fetch` does not use `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set. In the sandbox, prefix
commands with `NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1` so traffic goes through (and respects) the session proxy.

## Layout

```
src/
  cli.ts                 commander CLI
  types.ts               EvalCase / Reviewer / results types (zod schemas for the dataset)
  diff.ts                unified-diff parser, file filters, numbered rendering
  cache.ts               content-addressed JSON disk cache
  llm/provider.ts        Gemini, Groq, Mock, Fallback providers (+ retry/backoff)
  llm/pricing.ts         list-price table for cost estimates
  dataset/               SZZ builder: git.ts (log/blame), filters.ts (pure rules), annotate.ts (LLM labels), build.ts
  reviewers/             baseline.ts (single prompt), mock.ts (offline), diffwise.ts (adapter stub), index.ts
  judge/judge.ts         location check + LLM/keyword semantic judge
  judge/validate.ts      agreement with hand labels
  scoring/metrics.ts     all metrics (pure, tested)
  report/report.ts       markdown + HTML scoreboard
dataset/cases.json       the dataset
dataset/judge-labels.json hand labels for judge validation
results/                 committed run outputs (smoke run only)
reports/                 committed scoreboard (smoke run only)
tests/                   vitest
```

## Known issues

- GitHub REST API is blocked for other repos in the cloud sandbox (proxy 403) → dataset built from git history only;
  PR titles come from squash-commit subjects, PR bodies are not used. See Blockers.
- `gemini-3.5-flash` free tier intermittently returns 503 "high demand"; the provider retries 4× with backoff, and
  the dataset annotator falls back to Groq. Reviews that still fail are recorded with `error` and counted in the
  "Errors" column (not cached, so a re-run retries them).
- Pricing for `gemini-3.5-flash` and Groq `gpt-oss-*` is marked `assumed` in `src/llm/pricing.ts`; verify before quoting cost.
- SZZ is noisy by nature: some "introducing" PRs only moved/reformatted the line. Filters reduce this
  (whitespace-insensitive blame, majority vote, mechanical-commit filter, LLM rejection) but don't eliminate it.

## Decisions

- **Separate `evals/` package** with its own package.json, so it can't break (or be broken by) the bot while the bot is unfinished.
- **Dataset source: git history instead of the REST API / HF fallback.** The REST API was blocked, but `git clone` of
  public repos works through the proxy. Squash-merge subjects carry `(#123)`, so real merged PRs and real SZZ (`git
  blame`) are still possible — closer to the brief than switching to SWE-PolyBench (whose tasks have no
  bug-introducing PR). Builder still tries the REST API first (with `EVALS_GITHUB_TOKEN`) for PR metadata.
- **Repos:** 12 popular TS/JS repos that squash-merge with conventional commits (vue core, svelte, vitest, TanStack
  query, hono, zod, axios, date-fns, zustand, immer, ky, h3). Max 8 buggy + 2 clean per repo for diversity.
- **Fix filters:** `fix:` subject with PR number, not types/docs/deps/tests; ≤3 source files, ≤60 changed source
  lines, ≥1 deleted non-trivial line (pure additions can't be blamed). **Introducer filters:** majority (≥50%) of blamed
  lines, single-parent commit with a PR number, not mechanical (format/rename/release), ≤600 changed lines, ≤20 files.
- **Bug location** = the blamed lines, kept only if they are *added* lines in the introducing diff, merged into ranges.
- **Clean PRs:** `feat/perf/refactor` PRs ≥270 days old, 15–400 changed lines, never reverted, and no later fix commit
  touching their files (up to 15 checked) blames back to them. "Clean" = "no known bug", not "bug-free".
- **Annotator = Groq gpt-oss-120b, reviewer = Gemini.** The model that writes bug descriptions should not be the
  model under test (its own phrasing would make semantic matching easier). The judge is also gpt-oss-120b; this
  shares a model with the annotator but not with the reviewer.
- **Two catch rates:** strict (semantic + within ±5 lines) is the headline; "any line" shows how much is lost to bad line refs.
- **Precision is reported as a lower bound** (only the known bug counts as a true positive); noise on clean PRs is the main FP metric.
- **Cost is list-price equivalent** (free tiers bill $0) so reviewers are comparable.
- **Numbered diff in the baseline prompt** (new-side line numbers printed per line) — LLMs are bad at counting hunk offsets.
- **Judge validation set:** labels for (case, comments) items: the 4 buggy smoke-run reviews plus constructed comment sets
  that probe hard cases (paraphrase, right bug/wrong line, right line/wrong bug, generic advice). Running the real
  reviewer on 15 cases would have exceeded the 5-case run budget.
- **Branch:** the brief asked for `claude/evals-scoreboard`; used that (the session's default branch name was different).
- **Repo's `claude.md` tutoring rules** (the user hand-writes core bot pieces) don't apply here: this task was explicitly
  delegated, is outside the bot, and touches none of the bot's core pieces.

## Blockers & workarounds

| What failed | What I tried | Workaround | What you need to do |
|---|---|---|---|
| GitHub REST API for other repos → proxy 403 "GitHub access to this repository is not enabled for this session" (with `EVALS_GITHUB_TOKEN`) | curl + Node fetch through the proxy | Dataset mined from `git clone` + `git log`/`git blame` (real merged PRs via squash subjects). Builder keeps the API path for PR metadata when it is reachable. | Optional: run `npm run evals -- dataset build` locally with `EVALS_GITHUB_TOKEN` to add PR bodies to annotation. |
| `gemini-2.5-flash` → 404 "no longer available to new users" | listed models | default reviewer model `gemini-3.5-flash` | none |
| `gemini-3.5-flash` / `gemini-flash-latest` intermittent 503 | retry with backoff | Groq fallback for annotation; errors recorded per case | re-run failed cases later (cache skips successes) |
| Groq `llama-3.3-70b-versatile` → model_not_found | listed models | `openai/gpt-oss-120b` | none |

## Progress

- **Done:** scaffold (TS, ESLint, Vitest, CLI); diff parser; LLM providers + fallback; SZZ dataset builder; baseline,
  mock, silent reviewers + Diffwise HTTP adapter stub; LLM + keyword judge; metrics; markdown/HTML report; tests for scoring/judge/dataset rules.
- **In progress:** building dataset (`dataset/cases.json`).
- **Next:** hand labels + judge validation; 5-case smoke run with baseline + mock; report; README; PR.
