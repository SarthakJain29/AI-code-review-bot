/**
 * Baseline reviewer: one prompt, one LLM call, no repo context, no tools.
 * This is the bar any real reviewer (e.g. Diffwise) should clear.
 */
import { z } from 'zod';
import { commentableLines, parseDiff, renderNumberedDiff } from '../diff.js';
import { extractJson, type LlmProvider } from '../llm/provider.js';
import { SEVERITIES, type ReviewComment, type ReviewInput, type ReviewResult, type Reviewer } from '../types.js';

export const BASELINE_PROMPT_VERSION = 'v1';

export const BASELINE_SYSTEM = `You are a senior software engineer reviewing a pull request.
Find real problems in the CHANGED code: bugs, incorrect logic, unhandled edge cases, broken
behaviour, security issues. Do not comment on style, naming, formatting or missing tests.
Only report issues you are reasonably confident about; it is fine to report nothing.
Each comment must reference a file path and a line number exactly as shown in the numbered diff
(the number at the start of each line is the new-file line number).
Respond with JSON only: {"comments": [{"file": string, "line": number, "severity": "critical"|"major"|"minor"|"nit", "body": string}]}`;

const OutputSchema = z.object({
  comments: z
    .array(
      z.object({
        file: z.string(),
        line: z.coerce.number().int(),
        severity: z.enum(SEVERITIES).catch('minor'),
        body: z.string(),
      }),
    )
    .catch([]),
});

/** Parse + sanitise model output. Exported for tests. */
export function parseReviewOutput(text: string, diff: string): ReviewComment[] {
  const parsed = OutputSchema.parse(extractJson(text));
  const valid = commentableLines(parseDiff(diff));
  const files = [...valid.keys()];
  return parsed.comments.map((c) => {
    // Models sometimes drop a leading path segment or add "a/"/"b/" prefixes; snap to a real file.
    const clean = c.file.replace(/^[ab]\//, '');
    const file = valid.has(clean) ? clean : (files.find((f) => f.endsWith(clean) || clean.endsWith(f)) ?? clean);
    return { file, line: c.line, severity: c.severity, body: c.body.trim() };
  });
}

export class BaselineReviewer implements Reviewer {
  readonly id: string;
  constructor(private readonly llm: LlmProvider) {
    this.id = `baseline-${BASELINE_PROMPT_VERSION}:${llm.name}:${llm.model}`;
  }

  async review(input: ReviewInput): Promise<ReviewResult> {
    const prompt = `Repository: ${input.repo}\nPR title: ${input.title}\n\nNumbered diff:\n${renderNumberedDiff(parseDiff(input.diff))}`;
    const started = Date.now();
    try {
      const res = await this.llm.complete({ system: BASELINE_SYSTEM, prompt, json: true, temperature: 0 });
      return {
        comments: parseReviewOutput(res.text, input.diff),
        usage: { inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd, latencyMs: res.latencyMs, model: res.model },
      };
    } catch (e) {
      return {
        comments: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: Date.now() - started, model: this.llm.model },
        error: (e as Error).message.slice(0, 300),
      };
    }
  }
}
