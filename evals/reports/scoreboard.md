# AI PR Reviewer Scoreboard: gpt-oss-120b vs gpt-oss-20b (110 cases)

Generated 2026-11-08T00:39:35.717Z · dataset v1: 110 cases (91 buggy, 19 clean) from 12 repos · source: git-history SZZ over 12 TS/JS repos (GitHub REST API unavailable in build sandbox)

## Scoreboard

| Reviewer | Catch rate (strict) | 95% CI | Catch rate (bug file, any line) | Comments / clean PR | Silent on clean | Precision ≥ | Cost / review | Latency p50 / p95 | Errors |
|---|---|---|---|---|---|---|---|---|---|
| `baseline-v2:groq:openai/gpt-oss-120b` | 6.6% (6/91) | 3.1%–13.6% | 6.6% (6/91) | 1.11 | 47.4% (9/19) | 7.0% (9/128) | $0.00081 | 1.5s / 4.8s | 0 |
| `baseline-v2:groq:openai/gpt-oss-20b` | 6.6% (6/91) | 3.1%–13.6% | 7.7% (7/91) | 0.74 | 63.2% (12/19) | 6.7% (7/104) | $0.00046 | 1.4s / 4.2s | 0 |

Definitions: see `evals/README.md#metrics`. Cost is a list-price equivalent (free tiers cost $0).

## Catch rate by bug category

| Category | `baseline-v2:groq:openai/gpt-oss-120b` | `baseline-v2:groq:openai/gpt-oss-20b` |
|---|---|---|
| logic | 9.6% (5/52) | 5.8% (3/52) |
| edge-case | 0.0% (0/17) | 5.9% (1/17) |
| async-concurrency | 0.0% (0/6) | 0.0% (0/6) |
| state-mutation | 0.0% (0/4) | 0.0% (0/4) |
| api-contract | 0.0% (0/3) | 0.0% (0/3) |
| null-undefined | 0.0% (0/3) | 33.3% (1/3) |
| regex-string | 33.3% (1/3) | 33.3% (1/3) |
| performance | 0.0% (0/2) | 0.0% (0/2) |
| other | 0.0% (0/1) | 0.0% (0/1) |

## Judge validation

Judge `llm-judge-v2:groq:qwen/qwen3.8-27b` vs hand labels on 19 (case, comments) items: **accuracy 100.0%**, Cohen's κ 1.00.

Confusion (judge vs label): TP 9 · FP 0 · FN 0 · TN 10

## Per-case results

### `baseline-v2:groq:openai/gpt-oss-120b`

| Case | Kind | Category | Comments | Caught (strict / bug file) | Notes |
|---|---|---|---|---|---|
| [vuejs/core#16109](https://github.com/vuejs/core/pull/16109) | buggy | logic | 1 | ❌ / ❌ | cached |
| [vuejs/core#15430](https://github.com/vuejs/core/pull/15430) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [vuejs/core#12255](https://github.com/vuejs/core/pull/12255) | buggy | logic | 1 | ❌ / ❌ | cached |
| [vuejs/core#15627](https://github.com/vuejs/core/pull/15627) | buggy | logic | 0 | ❌ / ❌ | cached |
| [vuejs/core#11639](https://github.com/vuejs/core/pull/11639) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [vuejs/core#10734](https://github.com/vuejs/core/pull/10734) | buggy | logic | 0 | ❌ / ❌ | cached |
| [vuejs/core#14902](https://github.com/vuejs/core/pull/14902) | buggy | logic | 1 | ❌ / ❌ | cached |
| [vuejs/core#12308](https://github.com/vuejs/core/pull/12308) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [vuejs/core#14348](https://github.com/vuejs/core/pull/14348) | clean | – | 0 | – | cached |
| [vuejs/core#14308](https://github.com/vuejs/core/pull/14308) | clean | – | 0 | – | cached |
| [sveltejs/svelte#12604](https://github.com/sveltejs/svelte/pull/12604) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [sveltejs/svelte#10916](https://github.com/sveltejs/svelte/pull/10916) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [sveltejs/svelte#18944](https://github.com/sveltejs/svelte/pull/18944) | buggy | logic | 2 | ❌ / ❌ | cached |
| [sveltejs/svelte#16333](https://github.com/sveltejs/svelte/pull/16333) | buggy | logic | 0 | ❌ / ❌ | cached |
| [sveltejs/svelte#17105](https://github.com/sveltejs/svelte/pull/17105) | buggy | state-mutation | 2 | ❌ / ❌ | cached |
| [sveltejs/svelte#11879](https://github.com/sveltejs/svelte/pull/11879) | buggy | state-mutation | 1 | ❌ / ❌ | cached |
| [sveltejs/svelte#15460](https://github.com/sveltejs/svelte/pull/15460) | buggy | async-concurrency | 0 | ❌ / ❌ | cached |
| [sveltejs/svelte#12285](https://github.com/sveltejs/svelte/pull/12285) | buggy | logic | 1 | ❌ / ❌ | cached |
| [sveltejs/svelte#17575](https://github.com/sveltejs/svelte/pull/17575) | clean | – | 2 | – | cached |
| [sveltejs/svelte#17088](https://github.com/sveltejs/svelte/pull/17088) | clean | – | 2 | – | cached |
| [vitest-dev/vitest#5135](https://github.com/vitest-dev/vitest/pull/5135) | buggy | state-mutation | 1 | ❌ / ❌ | cached |
| [vitest-dev/vitest#9745](https://github.com/vitest-dev/vitest/pull/9745) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [vitest-dev/vitest#10656](https://github.com/vitest-dev/vitest/pull/10656) | buggy | logic | 1 | ❌ / ❌ | cached |
| [vitest-dev/vitest#9132](https://github.com/vitest-dev/vitest/pull/9132) | buggy | api-contract | 0 | ❌ / ❌ | cached |
| [vitest-dev/vitest#10170](https://github.com/vitest-dev/vitest/pull/10170) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [vitest-dev/vitest#11594](https://github.com/vitest-dev/vitest/pull/11594) | buggy | logic | 1 | ❌ / ❌ | cached |
| [vitest-dev/vitest#6070](https://github.com/vitest-dev/vitest/pull/6070) | buggy | regex-string | 1 | ✅ / ✅ | cached |
| [vitest-dev/vitest#11623](https://github.com/vitest-dev/vitest/pull/11623) | buggy | logic | 3 | ❌ / ❌ | cached |
| [vitest-dev/vitest#9581](https://github.com/vitest-dev/vitest/pull/9581) | clean | – | 0 | – | cached |
| [vitest-dev/vitest#9533](https://github.com/vitest-dev/vitest/pull/9533) | clean | – | 5 | – | cached |
| [TanStack/query#11679](https://github.com/TanStack/query/pull/11679) | buggy | logic | 1 | ❌ / ❌ | cached |
| [TanStack/query#11036](https://github.com/TanStack/query/pull/11036) | buggy | logic | 1 | ❌ / ❌ | cached |
| [TanStack/query#8496](https://github.com/TanStack/query/pull/8496) | buggy | logic | 1 | ❌ / ❌ | cached |
| [TanStack/query#9338](https://github.com/TanStack/query/pull/9338) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [TanStack/query#11166](https://github.com/TanStack/query/pull/11166) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [TanStack/query#8049](https://github.com/TanStack/query/pull/8049) | buggy | logic | 1 | ❌ / ❌ | cached |
| [TanStack/query#7312](https://github.com/TanStack/query/pull/7312) | buggy | async-concurrency | 8 | ❌ / ❌ | cached |
| [TanStack/query#6982](https://github.com/TanStack/query/pull/6982) | buggy | logic | 1 | ❌ / ❌ | cached |
| [TanStack/query#9914](https://github.com/TanStack/query/pull/9914) | clean | – | 1 | – | cached |
| [TanStack/query#9866](https://github.com/TanStack/query/pull/9866) | clean | – | 0 | – | cached |
| [honojs/hono#2350](https://github.com/honojs/hono/pull/2350) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [honojs/hono#5222](https://github.com/honojs/hono/pull/5222) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [honojs/hono#1215](https://github.com/honojs/hono/pull/1215) | buggy | regex-string | 1 | ❌ / ❌ | cached |
| [honojs/hono#5121](https://github.com/honojs/hono/pull/5121) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [honojs/hono#2314](https://github.com/honojs/hono/pull/2314) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [honojs/hono#2684](https://github.com/honojs/hono/pull/2684) | buggy | api-contract | 0 | ❌ / ❌ | cached |
| [honojs/hono#4078](https://github.com/honojs/hono/pull/4078) | buggy | logic | 2 | ✅ / ✅ | cached |
| [honojs/hono#1015](https://github.com/honojs/hono/pull/1015) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [honojs/hono#4626](https://github.com/honojs/hono/pull/4626) | clean | – | 0 | – | cached |
| [honojs/hono#4559](https://github.com/honojs/hono/pull/4559) | clean | – | 0 | – | cached |
| [colinhacks/zod#6705](https://github.com/colinhacks/zod/pull/6705) | buggy | logic | 1 | ❌ / ❌ | cached |
| [colinhacks/zod#6443](https://github.com/colinhacks/zod/pull/6443) | buggy | performance | 1 | ❌ / ❌ | cached |
| [colinhacks/zod#6652](https://github.com/colinhacks/zod/pull/6652) | buggy | logic | 1 | ❌ / ❌ | cached |
| [colinhacks/zod#6386](https://github.com/colinhacks/zod/pull/6386) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [colinhacks/zod#6347](https://github.com/colinhacks/zod/pull/6347) | buggy | regex-string | 0 | ❌ / ❌ | cached |
| [colinhacks/zod#6371](https://github.com/colinhacks/zod/pull/6371) | buggy | logic | 2 | ❌ / ❌ | cached |
| [colinhacks/zod#5793](https://github.com/colinhacks/zod/pull/5793) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [colinhacks/zod#4602](https://github.com/colinhacks/zod/pull/4602) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [colinhacks/zod#5610](https://github.com/colinhacks/zod/pull/5610) | clean | – | 0 | – | cached |
| [colinhacks/zod#5599](https://github.com/colinhacks/zod/pull/5599) | clean | – | 1 | – | cached |
| [axios/axios#6518](https://github.com/axios/axios/pull/6518) | buggy | state-mutation | 4 | ❌ / ❌ | cached |
| [axios/axios#10861](https://github.com/axios/axios/pull/10861) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#10957](https://github.com/axios/axios/pull/10957) | buggy | logic | 1 | ❌ / ❌ | cached |
| [axios/axios#11087](https://github.com/axios/axios/pull/11087) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#11138](https://github.com/axios/axios/pull/11138) | buggy | logic | 1 | ❌ / ❌ | cached |
| [axios/axios#10660](https://github.com/axios/axios/pull/10660) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#10795](https://github.com/axios/axios/pull/10795) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#10788](https://github.com/axios/axios/pull/10788) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#6265](https://github.com/axios/axios/pull/6265) | clean | – | 3 | – | cached |
| [axios/axios#7202](https://github.com/axios/axios/pull/7202) | clean | – | 0 | – | cached |
| [date-fns/date-fns#2720](https://github.com/date-fns/date-fns/pull/2720) | buggy | logic | 1 | ❌ / ❌ | cached |
| [date-fns/date-fns#2382](https://github.com/date-fns/date-fns/pull/2382) | buggy | logic | 1 | ❌ / ❌ | cached |
| [date-fns/date-fns#1105](https://github.com/date-fns/date-fns/pull/1105) | buggy | logic | 0 | ❌ / ❌ | cached |
| [date-fns/date-fns#1914](https://github.com/date-fns/date-fns/pull/1914) | buggy | logic | 28 | ✅ / ✅ | cached |
| [date-fns/date-fns#1765](https://github.com/date-fns/date-fns/pull/1765) | buggy | logic | 2 | ❌ / ❌ | cached |
| [date-fns/date-fns#1690](https://github.com/date-fns/date-fns/pull/1690) | buggy | logic | 3 | ❌ / ❌ | cached |
| [date-fns/date-fns#962](https://github.com/date-fns/date-fns/pull/962) | buggy | logic | 3 | ❌ / ❌ | cached |
| [pmndrs/zustand#3206](https://github.com/pmndrs/zustand/pull/3206) | buggy | null-undefined | 0 | ❌ / ❌ | cached |
| [pmndrs/zustand#2678](https://github.com/pmndrs/zustand/pull/2678) | buggy | async-concurrency | 1 | ❌ / ❌ | cached |
| [pmndrs/zustand#1144](https://github.com/pmndrs/zustand/pull/1144) | buggy | null-undefined | 0 | ❌ / ❌ | cached |
| [pmndrs/zustand#1789](https://github.com/pmndrs/zustand/pull/1789) | buggy | logic | 4 | ✅ / ✅ | cached |
| [pmndrs/zustand#1486](https://github.com/pmndrs/zustand/pull/1486) | buggy | api-contract | 1 | ❌ / ❌ | cached |
| [pmndrs/zustand#1460](https://github.com/pmndrs/zustand/pull/1460) | buggy | logic | 1 | ❌ / ❌ | cached |
| [pmndrs/zustand#1463](https://github.com/pmndrs/zustand/pull/1463) | buggy | async-concurrency | 0 | ❌ / ❌ | cached |
| [pmndrs/zustand#724](https://github.com/pmndrs/zustand/pull/724) | buggy | other | 1 | ❌ / ❌ | cached |
| [pmndrs/zustand#3032](https://github.com/pmndrs/zustand/pull/3032) | clean | – | 0 | – | cached |
| [pmndrs/zustand#2277](https://github.com/pmndrs/zustand/pull/2277) | clean | – | 3 | – | cached |
| [immerjs/immer#1255](https://github.com/immerjs/immer/pull/1255) | buggy | logic | 0 | ❌ / ❌ | cached |
| [immerjs/immer#912](https://github.com/immerjs/immer/pull/912) | buggy | logic | 0 | ❌ / ❌ | cached |
| [immerjs/immer#1014](https://github.com/immerjs/immer/pull/1014) | buggy | logic | 1 | ❌ / ❌ | cached |
| [immerjs/immer#771](https://github.com/immerjs/immer/pull/771) | buggy | logic | 0 | ❌ / ❌ | cached |
| [immerjs/immer#1164](https://github.com/immerjs/immer/pull/1164) | clean | – | 1 | – | cached |
| [sindresorhus/ky#736](https://github.com/sindresorhus/ky/pull/736) | buggy | logic | 0 | ❌ / ❌ | cached |
| [sindresorhus/ky#751](https://github.com/sindresorhus/ky/pull/751) | buggy | logic | 1 | ❌ / ❌ | cached |
| [sindresorhus/ky#760](https://github.com/sindresorhus/ky/pull/760) | buggy | null-undefined | 1 | ❌ / ❌ | cached |
| [sindresorhus/ky#540](https://github.com/sindresorhus/ky/pull/540) | buggy | logic | 2 | ❌ / ❌ | cached |
| [sindresorhus/ky#601](https://github.com/sindresorhus/ky/pull/601) | buggy | logic | 1 | ✅ / ✅ | cached |
| [sindresorhus/ky#466](https://github.com/sindresorhus/ky/pull/466) | buggy | async-concurrency | 0 | ❌ / ❌ | cached |
| [sindresorhus/ky#632](https://github.com/sindresorhus/ky/pull/632) | buggy | logic | 1 | ❌ / ❌ | cached |
| [sindresorhus/ky#536](https://github.com/sindresorhus/ky/pull/536) | buggy | logic | 0 | ❌ / ❌ | cached |
| [unjs/h3#1137](https://github.com/unjs/h3/pull/1137) | buggy | logic | 0 | ❌ / ❌ | cached |
| [unjs/h3#1212](https://github.com/unjs/h3/pull/1212) | buggy | logic | 7 | ❌ / ❌ |  |
| [unjs/h3#1097](https://github.com/unjs/h3/pull/1097) | buggy | logic | 1 | ❌ / ❌ |  |
| [unjs/h3#480](https://github.com/unjs/h3/pull/480) | buggy | logic | 1 | ✅ / ✅ |  |
| [unjs/h3#1509](https://github.com/unjs/h3/pull/1509) | buggy | async-concurrency | 2 | ❌ / ❌ |  |
| [unjs/h3#315](https://github.com/unjs/h3/pull/315) | buggy | logic | 1 | ❌ / ❌ |  |
| [unjs/h3#847](https://github.com/unjs/h3/pull/847) | buggy | performance | 1 | ❌ / ❌ |  |
| [unjs/h3#1008](https://github.com/unjs/h3/pull/1008) | buggy | logic | 0 | ❌ / ❌ |  |
| [unjs/h3#1242](https://github.com/unjs/h3/pull/1242) | clean | – | 1 | – |  |
| [unjs/h3#1234](https://github.com/unjs/h3/pull/1234) | clean | – | 2 | – |  |

### `baseline-v2:groq:openai/gpt-oss-20b`

| Case | Kind | Category | Comments | Caught (strict / bug file) | Notes |
|---|---|---|---|---|---|
| [vuejs/core#16109](https://github.com/vuejs/core/pull/16109) | buggy | logic | 3 | ❌ / ❌ | cached |
| [vuejs/core#15430](https://github.com/vuejs/core/pull/15430) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [vuejs/core#12255](https://github.com/vuejs/core/pull/12255) | buggy | logic | 1 | ❌ / ❌ | cached |
| [vuejs/core#15627](https://github.com/vuejs/core/pull/15627) | buggy | logic | 0 | ❌ / ❌ | cached |
| [vuejs/core#11639](https://github.com/vuejs/core/pull/11639) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [vuejs/core#10734](https://github.com/vuejs/core/pull/10734) | buggy | logic | 0 | ❌ / ❌ | cached |
| [vuejs/core#14902](https://github.com/vuejs/core/pull/14902) | buggy | logic | 0 | ❌ / ❌ | cached |
| [vuejs/core#12308](https://github.com/vuejs/core/pull/12308) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [vuejs/core#14348](https://github.com/vuejs/core/pull/14348) | clean | – | 0 | – | cached |
| [vuejs/core#14308](https://github.com/vuejs/core/pull/14308) | clean | – | 0 | – | cached |
| [sveltejs/svelte#12604](https://github.com/sveltejs/svelte/pull/12604) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [sveltejs/svelte#10916](https://github.com/sveltejs/svelte/pull/10916) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [sveltejs/svelte#18944](https://github.com/sveltejs/svelte/pull/18944) | buggy | logic | 1 | ✅ / ✅ | cached |
| [sveltejs/svelte#16333](https://github.com/sveltejs/svelte/pull/16333) | buggy | logic | 0 | ❌ / ❌ | cached |
| [sveltejs/svelte#17105](https://github.com/sveltejs/svelte/pull/17105) | buggy | state-mutation | 1 | ❌ / ❌ | cached |
| [sveltejs/svelte#11879](https://github.com/sveltejs/svelte/pull/11879) | buggy | state-mutation | 0 | ❌ / ❌ | cached |
| [sveltejs/svelte#15460](https://github.com/sveltejs/svelte/pull/15460) | buggy | async-concurrency | 0 | ❌ / ❌ | cached |
| [sveltejs/svelte#12285](https://github.com/sveltejs/svelte/pull/12285) | buggy | logic | 1 | ❌ / ❌ | cached |
| [sveltejs/svelte#17575](https://github.com/sveltejs/svelte/pull/17575) | clean | – | 0 | – | cached |
| [sveltejs/svelte#17088](https://github.com/sveltejs/svelte/pull/17088) | clean | – | 4 | – | cached |
| [vitest-dev/vitest#5135](https://github.com/vitest-dev/vitest/pull/5135) | buggy | state-mutation | 0 | ❌ / ❌ | cached |
| [vitest-dev/vitest#9745](https://github.com/vitest-dev/vitest/pull/9745) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [vitest-dev/vitest#10656](https://github.com/vitest-dev/vitest/pull/10656) | buggy | logic | 1 | ❌ / ❌ | cached |
| [vitest-dev/vitest#9132](https://github.com/vitest-dev/vitest/pull/9132) | buggy | api-contract | 2 | ❌ / ❌ | cached |
| [vitest-dev/vitest#10170](https://github.com/vitest-dev/vitest/pull/10170) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [vitest-dev/vitest#11594](https://github.com/vitest-dev/vitest/pull/11594) | buggy | logic | 1 | ❌ / ❌ | cached |
| [vitest-dev/vitest#6070](https://github.com/vitest-dev/vitest/pull/6070) | buggy | regex-string | 2 | ✅ / ✅ | cached |
| [vitest-dev/vitest#11623](https://github.com/vitest-dev/vitest/pull/11623) | buggy | logic | 3 | ❌ / ❌ | cached |
| [vitest-dev/vitest#9581](https://github.com/vitest-dev/vitest/pull/9581) | clean | – | 0 | – | cached |
| [vitest-dev/vitest#9533](https://github.com/vitest-dev/vitest/pull/9533) | clean | – | 4 | – | cached |
| [TanStack/query#11679](https://github.com/TanStack/query/pull/11679) | buggy | logic | 0 | ❌ / ❌ | cached |
| [TanStack/query#11036](https://github.com/TanStack/query/pull/11036) | buggy | logic | 0 | ❌ / ❌ | cached |
| [TanStack/query#8496](https://github.com/TanStack/query/pull/8496) | buggy | logic | 0 | ❌ / ❌ | cached |
| [TanStack/query#9338](https://github.com/TanStack/query/pull/9338) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [TanStack/query#11166](https://github.com/TanStack/query/pull/11166) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [TanStack/query#8049](https://github.com/TanStack/query/pull/8049) | buggy | logic | 2 | ❌ / ❌ | cached |
| [TanStack/query#7312](https://github.com/TanStack/query/pull/7312) | buggy | async-concurrency | 1 | ❌ / ❌ | cached |
| [TanStack/query#6982](https://github.com/TanStack/query/pull/6982) | buggy | logic | 4 | ❌ / ❌ | cached |
| [TanStack/query#9914](https://github.com/TanStack/query/pull/9914) | clean | – | 0 | – | cached |
| [TanStack/query#9866](https://github.com/TanStack/query/pull/9866) | clean | – | 1 | – | cached |
| [honojs/hono#2350](https://github.com/honojs/hono/pull/2350) | buggy | edge-case | 4 | ❌ / ❌ | cached |
| [honojs/hono#5222](https://github.com/honojs/hono/pull/5222) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [honojs/hono#1215](https://github.com/honojs/hono/pull/1215) | buggy | regex-string | 2 | ❌ / ❌ | cached |
| [honojs/hono#5121](https://github.com/honojs/hono/pull/5121) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [honojs/hono#2314](https://github.com/honojs/hono/pull/2314) | buggy | edge-case | 0 | ❌ / ❌ | cached |
| [honojs/hono#2684](https://github.com/honojs/hono/pull/2684) | buggy | api-contract | 0 | ❌ / ❌ | cached |
| [honojs/hono#4078](https://github.com/honojs/hono/pull/4078) | buggy | logic | 1 | ✅ / ✅ | cached |
| [honojs/hono#1015](https://github.com/honojs/hono/pull/1015) | buggy | edge-case | 2 | ❌ / ❌ | cached |
| [honojs/hono#4626](https://github.com/honojs/hono/pull/4626) | clean | – | 0 | – | cached |
| [honojs/hono#4559](https://github.com/honojs/hono/pull/4559) | clean | – | 0 | – | cached |
| [colinhacks/zod#6705](https://github.com/colinhacks/zod/pull/6705) | buggy | logic | 0 | ❌ / ❌ | cached |
| [colinhacks/zod#6443](https://github.com/colinhacks/zod/pull/6443) | buggy | performance | 0 | ❌ / ❌ | cached |
| [colinhacks/zod#6652](https://github.com/colinhacks/zod/pull/6652) | buggy | logic | 0 | ❌ / ❌ | cached |
| [colinhacks/zod#6386](https://github.com/colinhacks/zod/pull/6386) | buggy | edge-case | 13 | ✅ / ✅ | cached |
| [colinhacks/zod#6347](https://github.com/colinhacks/zod/pull/6347) | buggy | regex-string | 0 | ❌ / ❌ | cached |
| [colinhacks/zod#6371](https://github.com/colinhacks/zod/pull/6371) | buggy | logic | 1 | ❌ / ❌ | cached |
| [colinhacks/zod#5793](https://github.com/colinhacks/zod/pull/5793) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [colinhacks/zod#4602](https://github.com/colinhacks/zod/pull/4602) | buggy | edge-case | 1 | ❌ / ❌ | cached |
| [colinhacks/zod#5610](https://github.com/colinhacks/zod/pull/5610) | clean | – | 0 | – | cached |
| [colinhacks/zod#5599](https://github.com/colinhacks/zod/pull/5599) | clean | – | 0 | – | cached |
| [axios/axios#6518](https://github.com/axios/axios/pull/6518) | buggy | state-mutation | 1 | ❌ / ❌ | cached |
| [axios/axios#10861](https://github.com/axios/axios/pull/10861) | buggy | logic | 1 | ❌ / ❌ | cached |
| [axios/axios#10957](https://github.com/axios/axios/pull/10957) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#11087](https://github.com/axios/axios/pull/11087) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#11138](https://github.com/axios/axios/pull/11138) | buggy | logic | 1 | ❌ / ❌ | cached |
| [axios/axios#10660](https://github.com/axios/axios/pull/10660) | buggy | logic | 1 | ❌ / ❌ | cached |
| [axios/axios#10795](https://github.com/axios/axios/pull/10795) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#10788](https://github.com/axios/axios/pull/10788) | buggy | logic | 0 | ❌ / ❌ | cached |
| [axios/axios#6265](https://github.com/axios/axios/pull/6265) | clean | – | 1 | – | cached |
| [axios/axios#7202](https://github.com/axios/axios/pull/7202) | clean | – | 0 | – | cached |
| [date-fns/date-fns#2720](https://github.com/date-fns/date-fns/pull/2720) | buggy | logic | 4 | ❌ / ❌ | cached |
| [date-fns/date-fns#2382](https://github.com/date-fns/date-fns/pull/2382) | buggy | logic | 1 | ❌ / ❌ | cached |
| [date-fns/date-fns#1105](https://github.com/date-fns/date-fns/pull/1105) | buggy | logic | 0 | ❌ / ❌ | cached |
| [date-fns/date-fns#1914](https://github.com/date-fns/date-fns/pull/1914) | buggy | logic | 0 | ❌ / ❌ | cached |
| [date-fns/date-fns#1765](https://github.com/date-fns/date-fns/pull/1765) | buggy | logic | 1 | ❌ / ❌ | cached |
| [date-fns/date-fns#1690](https://github.com/date-fns/date-fns/pull/1690) | buggy | logic | 1 | ❌ / ❌ | cached |
| [date-fns/date-fns#962](https://github.com/date-fns/date-fns/pull/962) | buggy | logic | 2 | ❌ / ❌ | cached |
| [pmndrs/zustand#3206](https://github.com/pmndrs/zustand/pull/3206) | buggy | null-undefined | 1 | ❌ / ❌ | cached |
| [pmndrs/zustand#2678](https://github.com/pmndrs/zustand/pull/2678) | buggy | async-concurrency | 1 | ❌ / ❌ | cached |
| [pmndrs/zustand#1144](https://github.com/pmndrs/zustand/pull/1144) | buggy | null-undefined | 3 | ✅ / ✅ | cached |
| [pmndrs/zustand#1789](https://github.com/pmndrs/zustand/pull/1789) | buggy | logic | 0 | ❌ / ❌ | cached |
| [pmndrs/zustand#1486](https://github.com/pmndrs/zustand/pull/1486) | buggy | api-contract | 1 | ❌ / ❌ | cached |
| [pmndrs/zustand#1460](https://github.com/pmndrs/zustand/pull/1460) | buggy | logic | 1 | ❌ / ❌ | cached |
| [pmndrs/zustand#1463](https://github.com/pmndrs/zustand/pull/1463) | buggy | async-concurrency | 0 | ❌ / ❌ | cached |
| [pmndrs/zustand#724](https://github.com/pmndrs/zustand/pull/724) | buggy | other | 0 | ❌ / ❌ | cached |
| [pmndrs/zustand#3032](https://github.com/pmndrs/zustand/pull/3032) | clean | – | 0 | – | cached |
| [pmndrs/zustand#2277](https://github.com/pmndrs/zustand/pull/2277) | clean | – | 1 | – | cached |
| [immerjs/immer#1255](https://github.com/immerjs/immer/pull/1255) | buggy | logic | 0 | ❌ / ❌ | cached |
| [immerjs/immer#912](https://github.com/immerjs/immer/pull/912) | buggy | logic | 0 | ❌ / ❌ | cached |
| [immerjs/immer#1014](https://github.com/immerjs/immer/pull/1014) | buggy | logic | 0 | ❌ / ❌ | cached |
| [immerjs/immer#771](https://github.com/immerjs/immer/pull/771) | buggy | logic | 1 | ❌ / ❌ | cached |
| [immerjs/immer#1164](https://github.com/immerjs/immer/pull/1164) | clean | – | 0 | – | cached |
| [sindresorhus/ky#736](https://github.com/sindresorhus/ky/pull/736) | buggy | logic | 2 | ❌ / ✅ | cached |
| [sindresorhus/ky#751](https://github.com/sindresorhus/ky/pull/751) | buggy | logic | 0 | ❌ / ❌ | cached |
| [sindresorhus/ky#760](https://github.com/sindresorhus/ky/pull/760) | buggy | null-undefined | 1 | ❌ / ❌ | cached |
| [sindresorhus/ky#540](https://github.com/sindresorhus/ky/pull/540) | buggy | logic | 1 | ❌ / ❌ | cached |
| [sindresorhus/ky#601](https://github.com/sindresorhus/ky/pull/601) | buggy | logic | 1 | ✅ / ✅ | cached |
| [sindresorhus/ky#466](https://github.com/sindresorhus/ky/pull/466) | buggy | async-concurrency | 1 | ❌ / ❌ | cached |
| [sindresorhus/ky#632](https://github.com/sindresorhus/ky/pull/632) | buggy | logic | 1 | ❌ / ❌ | cached |
| [sindresorhus/ky#536](https://github.com/sindresorhus/ky/pull/536) | buggy | logic | 3 | ❌ / ❌ | cached |
| [unjs/h3#1137](https://github.com/unjs/h3/pull/1137) | buggy | logic | 0 | ❌ / ❌ | cached |
| [unjs/h3#1212](https://github.com/unjs/h3/pull/1212) | buggy | logic | 0 | ❌ / ❌ | cached |
| [unjs/h3#1097](https://github.com/unjs/h3/pull/1097) | buggy | logic | 4 | ❌ / ❌ | cached |
| [unjs/h3#480](https://github.com/unjs/h3/pull/480) | buggy | logic | 0 | ❌ / ❌ | cached |
| [unjs/h3#1509](https://github.com/unjs/h3/pull/1509) | buggy | async-concurrency | 2 | ❌ / ❌ | cached |
| [unjs/h3#315](https://github.com/unjs/h3/pull/315) | buggy | logic | 0 | ❌ / ❌ | cached |
| [unjs/h3#847](https://github.com/unjs/h3/pull/847) | buggy | performance | 4 | ❌ / ❌ |  |
| [unjs/h3#1008](https://github.com/unjs/h3/pull/1008) | buggy | logic | 8 | ❌ / ❌ | cached |
| [unjs/h3#1242](https://github.com/unjs/h3/pull/1242) | clean | – | 1 | – | cached |
| [unjs/h3#1234](https://github.com/unjs/h3/pull/1234) | clean | – | 2 | – | cached |
