/**
 * Baseline reviewer: one prompt, no repo context, no tools. One LLM call per diff (large diffs
 * are split into file/hunk chunks that each get the same prompt).
 * This is the bar any real reviewer (e.g. Diffwise) should clear.
 */
import { z } from 'zod';
import { commentableLines, parseDiff, renderNumberedDiff, type DiffFile } from '../diff.js';
import { DiskCache } from '../cache.js';
import { estimateTokens, extractJson, LlmError, type LlmProvider, type LlmResponse } from '../llm/provider.js';
import { SEVERITIES, type ReviewComment, type ReviewInput, type ReviewResult, type Reviewer } from '../types.js';

/** v2: same prompt as v1, plus file/hunk chunking for diffs over the per-call token budget. */
export const BASELINE_PROMPT_VERSION = 'v2';

/**
 * Split a parsed diff into chunks whose numbered rendering stays under `maxTokens`.
 * Files are kept whole when possible; a file that is too big on its own is split by hunks.
 * A single hunk larger than the budget becomes its own (oversized) chunk.
 */
export function chunkDiff(files: DiffFile[], maxTokens: number): DiffFile[][] {
  const size = (fs: DiffFile[]) => estimateTokens(renderNumberedDiff(fs));
  const pieces: DiffFile[] = [];
  for (const f of files) {
    if (size([f]) <= maxTokens || f.hunks.length <= 1) {
      pieces.push(f);
      continue;
    }
    let cur: DiffFile = { ...f, hunks: [] };
    for (const h of f.hunks) {
      const next = { ...cur, hunks: [...cur.hunks, h] };
      if (cur.hunks.length > 0 && size([next]) > maxTokens) {
        pieces.push(cur);
        cur = { ...f, hunks: [h] };
      } else cur = next;
    }
    if (cur.hunks.length) pieces.push(cur);
  }
  const chunks: DiffFile[][] = [];
  let cur: DiffFile[] = [];
  for (const p of pieces) {
    if (cur.length > 0 && size([...cur, p]) > maxTokens) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

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

export interface BaselineOptions {
  /**
   * Max estimated tokens of numbered diff per LLM call. Diffs above this are reviewed in
   * file/hunk chunks (one call each, comments merged). Default 4500 keeps prompt + output under
   * Groq's 8k free-tier TPM. Set EVALS_REVIEW_CHUNK_TOKENS higher on paid tiers.
   */
  chunkTokens?: number;
  maxOutputTokens?: number;
  /**
   * Per-chunk response cache. Without it, a chunked review that hits a daily quota on chunk k
   * throws away chunks 1..k-1 and re-spends their tokens on every retry.
   */
  chunkCache?: DiskCache;
}

export class BaselineReviewer implements Reviewer {
  readonly id: string;
  private readonly chunkTokens: number;
  private readonly maxOutputTokens: number;
  private readonly chunkCache?: DiskCache;
  constructor(
    private readonly llm: LlmProvider,
    opts: BaselineOptions = {},
  ) {
    this.chunkTokens = opts.chunkTokens ?? Number(process.env.EVALS_REVIEW_CHUNK_TOKENS ?? 4500);
    this.maxOutputTokens = opts.maxOutputTokens ?? 2048;
    this.chunkCache = opts.chunkCache;
    this.id = `baseline-${BASELINE_PROMPT_VERSION}:${llm.name}:${llm.model}`;
  }

  async review(input: ReviewInput): Promise<ReviewResult> {
    const chunks = chunkDiff(parseDiff(input.diff), this.chunkTokens);
    const comments: ReviewComment[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, model: this.llm.model, calls: 0 };
    try {
      for (const [i, chunk] of chunks.entries()) {
        const part = chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length}; other files are reviewed separately)` : '';
        const prompt = `Repository: ${input.repo}\nPR title: ${input.title}\n\nNumbered diff${part}:\n${renderNumberedDiff(chunk)}`;
        const key = DiskCache.key('chunk', this.id, String(this.maxOutputTokens), prompt);
        let res = this.chunkCache?.get<LlmResponse>(key);
        if (!res) {
          res = await this.llm.complete({ system: BASELINE_SYSTEM, prompt, json: true, temperature: 0, maxOutputTokens: this.maxOutputTokens });
          this.chunkCache?.set(key, res);
        }
        comments.push(...parseReviewOutput(res.text, input.diff));
        usage.inputTokens += res.inputTokens;
        usage.outputTokens += res.outputTokens;
        usage.costUsd += res.costUsd;
        usage.latencyMs += res.latencyMs; // sequential calls: total time the review takes
        usage.calls++;
      }
      return { comments, usage };
    } catch (e) {
      return {
        comments: [],
        usage,
        error: (e as Error).message.slice(0, 300),
        ...(e instanceof LlmError && e.quotaExhausted ? { quotaExhausted: true } : {}),
      };
    }
  }
}
