# AI PR Reviewer Scoreboard — 5-case smoke test

Generated 2026-11-04T21:19:45.392Z · dataset v1: 110 cases (91 buggy, 19 clean) from 12 repos · source: git-history SZZ over 12 TS/JS repos (GitHub REST API unavailable in build sandbox)

> **Sample run** — only a subset of the dataset was evaluated. Numbers have very wide error bars and are NOT a benchmark result.

## Scoreboard

| Reviewer | Catch rate (strict) | 95% CI | Catch rate (any line) | Comments / clean PR | Silent on clean | Precision ≥ | Cost / review | Latency p50 / p95 | Errors |
|---|---|---|---|---|---|---|---|---|---|
| `baseline-v1:gemini:gemini-3.1-flash-lite` | 0.0% (0/4) | 0.0%–49.0% | 0.0% (0/4) | 1.00 | 0.0% (0/1) | 0.0% (0/4) | $0.00023 | 1.2s / 1.8s | 0 |
| `mock-heuristic-v1` | 0.0% (0/4) | 0.0%–49.0% | 0.0% (0/4) | 0.00 | 100.0% (1/1) | – | $0.00000 | 1ms / 1ms | 0 |

Definitions: see `evals/README.md#metrics`. Cost is a list-price equivalent (free tiers cost $0).

## Catch rate by bug category

| Category | `baseline-v1:gemini:gemini-3.1-flash-lite` | `mock-heuristic-v1` |
|---|---|---|
| logic | 0.0% (0/2) | 0.0% (0/2) |
| edge-case | 0.0% (0/1) | 0.0% (0/1) |
| state-mutation | 0.0% (0/1) | 0.0% (0/1) |

## Judge validation

Judge `llm-judge-v1:groq:openai/gpt-oss-120b` vs hand labels on 19 (case, comments) items: **accuracy 100.0%**, Cohen's κ 1.00.

Confusion (judge vs label): TP 9 · FP 0 · FN 0 · TN 10

## Per-case results

### `baseline-v1:gemini:gemini-3.1-flash-lite`

| Case | Kind | Category | Comments | Caught (strict / any line) | Notes |
|---|---|---|---|---|---|
| [vuejs/core#16109](https://github.com/vuejs/core/pull/16109) | buggy | logic | 1 | ❌ / ❌ |  |
| [sveltejs/svelte#12604](https://github.com/sveltejs/svelte/pull/12604) | buggy | edge-case | 1 | ❌ / ❌ |  |
| [vitest-dev/vitest#5135](https://github.com/vitest-dev/vitest/pull/5135) | buggy | state-mutation | 1 | ❌ / ❌ |  |
| [TanStack/query#11679](https://github.com/TanStack/query/pull/11679) | buggy | logic | 1 | ❌ / ❌ |  |
| [vuejs/core#14348](https://github.com/vuejs/core/pull/14348) | clean | – | 1 | – |  |

### `mock-heuristic-v1`

| Case | Kind | Category | Comments | Caught (strict / any line) | Notes |
|---|---|---|---|---|---|
| [vuejs/core#16109](https://github.com/vuejs/core/pull/16109) | buggy | logic | 0 | ❌ / ❌ | cached |
| [vuejs/core#14348](https://github.com/vuejs/core/pull/14348) | clean | – | 0 | – | cached |
| [sveltejs/svelte#12604](https://github.com/sveltejs/svelte/pull/12604) | buggy | edge-case | 0 | ❌ / ❌ |  |
| [vitest-dev/vitest#5135](https://github.com/vitest-dev/vitest/pull/5135) | buggy | state-mutation | 0 | ❌ / ❌ |  |
| [TanStack/query#11679](https://github.com/TanStack/query/pull/11679) | buggy | logic | 0 | ❌ / ❌ |  |
