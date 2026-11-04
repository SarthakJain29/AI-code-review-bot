/**
 * Judge: did any review comment identify the known bug?
 *
 * Two independent checks per comment:
 *  - location match (deterministic): same file and line within ±tolerance of a bug range;
 *  - semantic match (LLM, or keyword overlap in mock mode): the comment describes the same defect.
 * "caught" (strict, the headline number) needs both on the same comment.
 * "caughtAnyLocation" (lenient) needs only the semantic match, to expose line-number sloppiness.
 */
import { z } from 'zod';
import { DiskCache } from '../cache.js';
import { isTestFile, parseDiff, renderDiff } from '../diff.js';
import { extractJson, type LlmProvider } from '../llm/provider.js';
import type { BugLocation, CommentVerdict, EvalCase, JudgeVerdict, ReviewComment } from '../types.js';

export const JUDGE_PROMPT_VERSION = 'v1';
export const DEFAULT_LINE_TOLERANCE = 5;

function normPath(p: string): string {
  return p.replace(/^\.?\//, '').replace(/^[ab]\//, '');
}

export function pathsMatch(a: string, b: string): boolean {
  const x = normPath(a);
  const y = normPath(b);
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

export function locationMatches(c: Pick<ReviewComment, 'file' | 'line'>, locs: BugLocation[], tolerance = DEFAULT_LINE_TOLERANCE): boolean {
  return locs.some((l) => pathsMatch(c.file, l.file) && c.line >= l.lines.start - tolerance && c.line <= l.lines.end + tolerance);
}

export interface Judge {
  readonly id: string;
  judge(c: EvalCase, comments: ReviewComment[]): Promise<JudgeVerdict>;
}

function combine(id: string, perComment: CommentVerdict[], usage?: JudgeVerdict['judgeUsage']): JudgeVerdict {
  const matched = perComment.filter((v) => v.semanticMatch && v.locationMatch).map((v) => v.index);
  return {
    caught: matched.length > 0,
    caughtAnyLocation: perComment.some((v) => v.semanticMatch),
    matchedIndices: matched,
    perComment,
    judgeModel: id,
    ...(usage ? { judgeUsage: usage } : {}),
  };
}

// ---------- keyword judge (offline / mock mode) ----------

const STOP = new Set(
  'the a an of to in on for and or is are be it this that with when not no by as at from can will should could would which into its if then than but was were has have had does do may might there their they them function value values code line lines file use used using'.split(
    ' ',
  ),
);

export function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9_$]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Share of the bug description's content words that also appear in the comment. */
export function keywordOverlap(description: string, comment: string): number {
  const d = contentWords(description);
  if (d.size === 0) return 0;
  const c = contentWords(comment);
  let hit = 0;
  for (const w of d) if (c.has(w)) hit++;
  return hit / d.size;
}

export class KeywordJudge implements Judge {
  readonly id = 'keyword-judge-v1';
  constructor(
    private readonly threshold = 0.25,
    private readonly tolerance = DEFAULT_LINE_TOLERANCE,
  ) {}
  async judge(c: EvalCase, comments: ReviewComment[]): Promise<JudgeVerdict> {
    const bug = c.bug;
    if (!bug) return combine(this.id, []);
    const per = comments.map((cm, index) => {
      const overlap = keywordOverlap(bug.description, cm.body);
      return {
        index,
        locationMatch: locationMatches(cm, bug.locations, this.tolerance),
        semanticMatch: overlap >= this.threshold,
        reason: `keyword overlap ${(overlap * 100).toFixed(0)}%`,
      };
    });
    return combine(this.id, per);
  }
}

// ---------- LLM judge ----------

export const JUDGE_SYSTEM = `You grade an automated code reviewer against a KNOWN bug.
You get: the known bug's description, its location, the code that was later changed to fix it, and a
numbered list of review comments. For EACH comment decide "match": does it identify the SAME defect
(same root cause / same wrong behaviour) as the known bug? Be strict:
- A comment matches if a developer reading it would be led to find and fix this bug, even if wording,
  severity or the suggested fix differ.
- Generic advice ("add tests", "handle errors", "check for null" with no link to this bug's cause) does not match.
- A different real problem in the same lines does not match.
Ignore line numbers when deciding "match"; location is checked separately.
Respond with JSON: {"verdicts": [{"index": number, "match": boolean, "reason": string}]}`;

const JudgeOutput = z.object({
  verdicts: z.array(z.object({ index: z.coerce.number().int(), match: z.boolean(), reason: z.string().catch('') })),
});

/** Put non-test files first so the prompt budget goes to the actual fix. */
function sourceFirst(diff: string): string {
  const files = parseDiff(diff);
  if (files.length === 0) return diff;
  return renderDiff([...files].sort((a, b) => Number(isTestFile(a.newPath ?? a.oldPath ?? '')) - Number(isTestFile(b.newPath ?? b.oldPath ?? ''))));
}

export function buildJudgePrompt(c: EvalCase, comments: ReviewComment[]): string {
  const bug = c.bug!;
  const locs = bug.locations.map((l) => `${l.file}:${l.lines.start}-${l.lines.end}`).join(', ');
  const list = comments.map((cm, i) => `[${i}] ${cm.file}:${cm.line} (${cm.severity}) ${cm.body}`).join('\n');
  return `Known bug (${bug.category}) at ${locs}:
${bug.description}

How it was fixed later (${bug.fixPr.title}):
${sourceFirst(bug.fixDiff).slice(0, 6000)}

Review comments:
${list}`;
}

export class LlmJudge implements Judge {
  readonly id: string;
  constructor(
    private readonly llm: LlmProvider,
    private readonly cache: DiskCache,
    private readonly tolerance = DEFAULT_LINE_TOLERANCE,
  ) {
    this.id = `llm-judge-${JUDGE_PROMPT_VERSION}:${llm.name}:${llm.model}`;
  }

  async judge(c: EvalCase, comments: ReviewComment[]): Promise<JudgeVerdict> {
    const bug = c.bug;
    if (!bug || comments.length === 0) return combine(this.id, []);
    const shown = comments.slice(0, 30);
    const prompt = buildJudgePrompt(c, shown);
    const key = DiskCache.key('judge', this.id, prompt);
    let raw = this.cache.get<{ verdicts: { index: number; match: boolean; reason: string }[]; usage: JudgeVerdict['judgeUsage'] }>(key);
    if (!raw) {
      const res = await this.llm.complete({ system: JUDGE_SYSTEM, prompt, json: true, temperature: 0, maxOutputTokens: 2000 });
      const parsed = JudgeOutput.parse(extractJson(res.text));
      raw = {
        verdicts: parsed.verdicts,
        usage: { inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd, latencyMs: res.latencyMs, model: res.model },
      };
      this.cache.set(key, raw);
    }
    const byIndex = new Map(raw.verdicts.map((v) => [v.index, v]));
    const per: CommentVerdict[] = comments.map((cm, index) => ({
      index,
      locationMatch: locationMatches(cm, bug.locations, this.tolerance),
      semanticMatch: byIndex.get(index)?.match ?? false,
      reason: byIndex.get(index)?.reason ?? (index >= shown.length ? 'not shown to judge (over limit)' : 'no verdict returned'),
    }));
    return combine(this.id, per, raw.usage);
  }
}
