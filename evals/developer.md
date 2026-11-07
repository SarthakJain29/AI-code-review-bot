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
| `EVALS_REVIEWER_PROVIDER` / `EVALS_REVIEWER_MODEL` | override baseline model (default `gemini` / `gemini-3.1-flash-lite`) | – | defaults |
| `EVALS_JUDGE_PROVIDER` / `EVALS_JUDGE_MODEL` | override judge (default `groq` / `qwen/qwen3.8-27b`; also `--judge-provider/--judge-model`) | – | defaults |
| `EVALS_GROQ_TPM` | client-side tokens/minute throttle per Groq model (default 8000 = free tier) | – | default |
| `EVALS_REVIEW_CHUNK_TOKENS` | max diff tokens per baseline call before chunking (default 4500) | – | default |
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

## Full runs (free tier)

```bash
NODE_USE_ENV_PROXY=1 npx tsx src/cli.ts run --reviewer baseline --provider groq --model openai/gpt-oss-120b --until-done --out results/full-gpt-oss-120b.json
NODE_USE_ENV_PROXY=1 npx tsx src/cli.ts run --reviewer baseline --provider groq --model openai/gpt-oss-20b  --until-done --out results/full-gpt-oss-20b.json
npx tsx src/cli.ts report --runs results/full-gpt-oss-120b.json,results/full-gpt-oss-20b.json --out reports/scoreboard
```

Groq free tier per model: 8k tokens/min, 1k requests/day, **200k tokens/day (rolling 24 h)**. One reviewer pass over the
dataset needs ~300–400k tokens and the judge ~200–300k, so a full run spans 2+ days. `--until-done` stops a pass when
a daily quota is hit (the remaining cases are listed as `pending`), waits `--wait-minutes`, and resumes. Resuming
reads the `--out` file first, so it survives a lost `.cache/` (new container); commit the partial results file.

## Known issues

- GitHub REST API is blocked for other repos in the cloud sandbox (proxy 403) → dataset built from git history only;
  PR titles come from squash-commit subjects, PR bodies are not used. See Blockers.
- `gemini-3.5-flash` free tier allows only **20 requests/day** and also returned 503s, so the default reviewer is
  `gemini-3.1-flash-lite`. For a full run on a stronger model, use a paid key or `--provider groq --model qwen/qwen3.8-27b`.
- Gemini free-tier models intermittently return 503 "high demand"; the provider retries 4× with backoff, and
  the dataset annotator falls back to Groq. Reviews that still fail are recorded with `error` and counted in the
  "Errors" column (not cached, so a re-run retries them).
- Pricing for Gemini 3.x and Groq `gpt-oss-*` is marked `assumed` in `src/llm/pricing.ts`; verify before quoting cost.
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
- **Annotation split for speed:** Groq's free tier is 8k tokens/min per model, so one annotator would have taken
  hours. Rate limits are per model, so the first 6 repos (vue, svelte, vitest, query, hono, zod) are annotated by
  Groq `openai/gpt-oss-120b` and the other 6 (axios, date-fns, zustand, immer, ky, h3) by Groq `openai/gpt-oss-20b`.
  Each case records its annotator in `annotation.model`. Neither shares a family with the Gemini baseline.
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

- **Full-run reviewers:** Groq `openai/gpt-oss-120b` (the best free model) vs `openai/gpt-oss-20b` (small/cheap), on
  the same provider so latency and cost are comparable. Groq's prices were confirmed on console.groq.com/docs/models
  (gpt-oss-120b $0.15/$0.60, gpt-oss-20b $0.075/$0.30, qwen3.8-27b $0.80/$4.00 per 1M in/out).
- **Judge changed to Qwen (`qwen/qwen3.8-27b`)** because the reviewers are now gpt-oss; a gpt-oss judge would be grading
  its own family. Re-validated on the 19 hand labels: Qwen 100% (κ 1.0); Gemini flash-lite 94.7% (accepted generic
  "potential DoS" advice); the earlier gpt-oss-120b judge was 100%.
- **Judge v2** sends only comments in a bug file to the LLM (others can't be strict catches) and caps the fix diff at
  3500 chars. This cut judge tokens ~2–3× to fit 200k tokens/day. "Any line" is therefore "any line of a bug file".
- **Baseline v2** = same prompt, but diffs over ~4500 tokens are reviewed in file/hunk chunks (one call each, comments
  merged). Needed because one 8k-TPM request can't hold the largest diffs (max ≈11k tokens). Latency for chunked
  reviews is the sum of their calls.
- **Latency** now measures only successful HTTP calls (excludes throttle/retry waits), so rate limits don't distort it.

## Blockers & workarounds

| What failed | What I tried | Workaround | What you need to do |
|---|---|---|---|
| GitHub REST API for other repos → proxy 403 "GitHub access to this repository is not enabled for this session" (with `EVALS_GITHUB_TOKEN`) | curl + Node fetch through the proxy | Dataset mined from `git clone` + `git log`/`git blame` (real merged PRs via squash subjects). Builder keeps the API path for PR metadata when it is reachable. | Optional: run `npm run evals -- dataset build` locally with `EVALS_GITHUB_TOKEN` to add PR bodies to annotation. |
| `gemini-2.5-flash` → 404 "no longer available to new users" | listed models | tried `gemini-3.5-flash` | none |
| `gemini-3.5-flash` free tier: 20 requests/day (quota hit during dataset annotation) | checked other models | default reviewer `gemini-3.1-flash-lite`; annotation on Groq models | for a full eval on a stronger Gemini, use a paid key (`EVALS_REVIEWER_MODEL=gemini-3.5-flash`) |
| Groq 200k tokens/day per model (rolling); yesterday's dataset annotation had used most of today's gpt-oss quota | throttle + chunking + smaller judge prompt | `--until-done` resume loop; results committed as they accrue | nothing, or a Groq Dev-tier key to finish in ~1 h |
| Chunked reviews that hit the daily quota mid-diff discarded their finished chunks, so each 15-min retry re-spent ~5k tokens and kept the 120b quota pinned at ~199k for hours | – | per-chunk response cache (`.cache/chunks`); reviewer id unchanged since outputs are identical | none |
| Groq HTTP 413 "request too large" on some date-fns chunks (one hunk bigger than the chunk budget, and the chars/token estimate runs low on dense code) | – | chunkDiff now splits oversized hunks into line runs; on a 413 the chunk is re-split at half the budget | none |
| Groq JSON mode 400 `json_validate_failed` (gpt-oss-20b, empty generation) | – | retry once without JSON mode, parse text | none |
| `gemini-3.5-flash` / `gemini-flash-latest` intermittent 503 | retry with backoff | Groq fallback for annotation; errors recorded per case | re-run failed cases later (cache skips successes) |
| Groq `llama-3.3-70b-versatile` → model_not_found | listed models | `openai/gpt-oss-120b` | none |

## Progress

- **Done:** harness, dataset (91 buggy + 19 clean), judge validation (Qwen v2 100%, κ 1.0), smoke run; full-run tooling
  (TPM throttle, chunking, quota stop/resume, `--until-done`).
- **In progress:** full runs of gpt-oss-120b and gpt-oss-20b (`results/full-gpt-oss-*.json`), resuming as Groq's daily quota frees up.
- **Next:** when both have 0 pending: `report --runs results/full-gpt-oss-120b.json,results/full-gpt-oss-20b.json`, fill the
  README "Results" section, push, update PR.
