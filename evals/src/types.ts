import { z } from 'zod';

/** Bug taxonomy used for the per-category breakdown. Kept small on purpose. */
export const BUG_CATEGORIES = [
  'logic', // wrong condition / wrong branch / off-by-one style logic error
  'null-undefined', // missing null/undefined/empty handling
  'edge-case', // boundary or unusual input not handled
  'async-concurrency', // promises, races, ordering, lifecycle timing
  'type-coercion', // JS type/coercion/typeof/instanceof issues
  'api-contract', // wrong return value/shape, broken option/param handling
  'state-mutation', // shared/mutable state, caching, stale data
  'regex-string', // string building, parsing, regex, encoding
  'performance', // accidental quadratic work, leaks
  'other',
] as const;
export type BugCategory = (typeof BUG_CATEGORIES)[number];

export const SEVERITIES = ['critical', 'major', 'minor', 'nit'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A single review comment produced by a reviewer. `line` is a NEW-side line number of the diff. */
export const ReviewCommentSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  body: z.string(),
  severity: z.enum(SEVERITIES),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const LineRangeSchema = z.object({ start: z.number().int(), end: z.number().int() });

export const BugLocationSchema = z.object({
  file: z.string(),
  /** Inclusive line range, in the NEW-side coordinates of the introducing diff. */
  lines: LineRangeSchema,
});
export type BugLocation = z.infer<typeof BugLocationSchema>;

export const PrRefSchema = z.object({
  number: z.number().int().nullable(),
  commit: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  date: z.string(),
});

export const EvalCaseSchema = z.object({
  id: z.string(),
  kind: z.enum(['buggy', 'clean']),
  repo: z.string(),
  /** The PR under review (for buggy cases: the bug-introducing PR). */
  pr: PrRefSchema,
  /** Unified diff of the PR under review (filtered: no lockfiles/generated files). */
  diff: z.string(),
  diffStats: z.object({ files: z.number(), additions: z.number(), deletions: z.number() }),
  /** Present for buggy cases only. */
  bug: z
    .object({
      locations: z.array(BugLocationSchema).min(1),
      description: z.string(),
      category: z.enum(BUG_CATEGORIES),
      fixPr: PrRefSchema,
      fixDiff: z.string(),
      /** How the introducing commit was found, for auditability. */
      szz: z.object({
        blamedLines: z.number(),
        blamedLinesToIntroducer: z.number(),
        candidateIntroducers: z.number(),
      }),
    })
    .optional(),
  /** How the description/category were produced. */
  annotation: z.object({ by: z.enum(['llm', 'heuristic', 'human']), model: z.string().optional() }).optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const DatasetSchema = z.object({
  version: z.number(),
  generatedAt: z.string(),
  source: z.string(),
  cases: z.array(EvalCaseSchema),
});
export type Dataset = z.infer<typeof DatasetSchema>;

/** LLM token usage + timing of one review. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Estimated list-price cost in USD (free tiers are $0 in practice). */
  costUsd: number;
  latencyMs: number;
  model: string;
}

export interface ReviewResult {
  comments: ReviewComment[];
  usage: Usage;
  /** Set if the reviewer failed; the case then counts as "no comments" and is flagged. */
  error?: string;
}

export interface ReviewInput {
  diff: string;
  repo: string;
  title: string;
}

/**
 * The contract every reviewer (baseline, Diffwise, mock, ...) implements.
 * `id` must change whenever behaviour changes (model, prompt version) so caches don't go stale.
 */
export interface Reviewer {
  readonly id: string;
  review(input: ReviewInput): Promise<ReviewResult>;
}

/** Per-comment verdict from the judge for a buggy case. */
export interface CommentVerdict {
  index: number;
  locationMatch: boolean;
  semanticMatch: boolean;
  reason: string;
}

export interface JudgeVerdict {
  /** Strict: some comment matches the bug semantically AND is within the location tolerance. */
  caught: boolean;
  /** Lenient: some comment matches semantically, anywhere in the diff. */
  caughtAnyLocation: boolean;
  matchedIndices: number[];
  perComment: CommentVerdict[];
  judgeModel: string;
  judgeUsage?: Omit<Usage, 'latencyMs'> & { latencyMs: number };
}

export interface CaseResult {
  caseId: string;
  kind: 'buggy' | 'clean';
  category?: BugCategory;
  review: ReviewResult;
  verdict?: JudgeVerdict;
  cached: boolean;
}

export interface RunResult {
  runId: string;
  reviewerId: string;
  judgeId: string;
  startedAt: string;
  finishedAt: string;
  datasetVersion: number;
  caseCount: number;
  results: CaseResult[];
  notes: string[];
}
