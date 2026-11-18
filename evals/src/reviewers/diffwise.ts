/**
 * Adapter for the real Diffwise reviewer — NOT wired yet because the bot is unfinished.
 *
 * Two ways to plug it in later (see README "Plugging in Diffwise"):
 *  1. In-process: once the bot exposes a pure function like
 *       reviewDiff({ diff, repo, title }): Promise<{ comments, usage }>
 *     import it here and call it inside `review()`.
 *  2. Over HTTP: run the bot locally and expose an eval-only endpoint that accepts
 *       POST { diff, repo, title }  ->  { comments: [{file,line,body,severity}], usage?: {...} }
 *     then set DIFFWISE_REVIEW_URL and run `--reviewer diffwise`.
 *
 * Important: evaluate the *review step only* (diff in, comments out). Webhooks, queues and
 * GitHub posting are infrastructure and must not affect the score.
 */
import { z } from 'zod';
import { ReviewCommentSchema, type ReviewInput, type ReviewResult, type Reviewer } from '../types.js';

const ResponseSchema = z.object({
  comments: z.array(ReviewCommentSchema),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number().optional(), model: z.string().optional() })
    .partial()
    .optional(),
});

export class DiffwiseHttpReviewer implements Reviewer {
  readonly id: string;
  constructor(
    private readonly url: string,
    version = process.env.DIFFWISE_VERSION ?? 'dev',
  ) {
    this.id = `diffwise-${version}`;
  }

  async review(input: ReviewInput): Promise<ReviewResult> {
    const started = Date.now();
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = ResponseSchema.parse(await res.json());
      return {
        comments: body.comments,
        usage: {
          inputTokens: body.usage?.inputTokens ?? 0,
          outputTokens: body.usage?.outputTokens ?? 0,
          costUsd: body.usage?.costUsd ?? 0,
          latencyMs: Date.now() - started,
          model: body.usage?.model ?? 'diffwise',
        },
      };
    } catch (e) {
      return {
        comments: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: Date.now() - started, model: 'diffwise' },
        error: (e as Error).message,
      };
    }
  }
}
