/**
 * Turns a raw SZZ pair into a short, reviewer-facing bug description + category, and rejects
 * pairs that are not real logic bugs. Uses an LLM when available, otherwise a keyword heuristic.
 */
import { z } from 'zod';
import { BUG_CATEGORIES, type BugCategory } from '../types.js';
import { extractJson, type LlmProvider } from '../llm/provider.js';
import { cleanSubject, heuristicCategory } from './filters.js';
import { DiskCache } from '../cache.js';

export interface AnnotationInput {
  repo: string;
  fixSubject: string;
  fixBody: string;
  fixDiff: string;
  introSubject: string;
  /** Numbered snippet of the blamed lines in the introducing version. */
  bugSnippet: string;
}

export interface Annotation {
  isLogicBug: boolean;
  description: string;
  category: BugCategory;
  rejectReason?: string;
  by: 'llm' | 'heuristic';
  model?: string;
}

const AnnotationSchema = z.object({
  is_logic_bug: z.boolean(),
  description: z.string(),
  category: z.enum(BUG_CATEGORIES).catch('other'),
  reject_reason: z.string().optional().nullable(),
});

const SYSTEM = `You label bugs for a code-review benchmark. You get (1) a merged bug-fix commit and (2) the lines of an
earlier PR that SZZ blame says introduced the bug. Decide whether the earlier PR really introduced a runtime
logic bug that a careful code reviewer could have spotted from that PR's diff alone.
Reject (is_logic_bug=false) when: the fix is only types/typings/docs/tests/formatting/deps/build; the fix
adds a new feature or changes intended behaviour; the blamed lines are unrelated to the actual defect; or the
bug depends on context a reviewer could not see.
Write "description" as 1-2 sentences describing what is wrong in the INTRODUCING code (not the fix), concrete
enough that a judge can tell whether a review comment points at the same problem.
Categories: ${BUG_CATEGORIES.join(', ')}.
Respond with JSON: {"is_logic_bug": boolean, "description": string, "category": string, "reject_reason": string|null}`;

export async function annotate(input: AnnotationInput, llm: LlmProvider | null, cache: DiskCache): Promise<Annotation> {
  const fallback: Annotation = {
    isLogicBug: true,
    description: `${cleanSubject(input.fixSubject)} (from the fix commit message).`,
    category: heuristicCategory(`${input.fixSubject} ${input.fixBody}`),
    by: 'heuristic',
  };
  if (!llm) return fallback;
  const prompt = `Repository: ${input.repo}
Bug-introducing PR title: ${input.introSubject}
Blamed lines in the introducing version (line numbers are new-side):
${input.bugSnippet}

Fix commit: ${input.fixSubject}
${input.fixBody.slice(0, 1500)}

Fix diff:
${input.fixDiff.slice(0, 8000)}`;
  const key = DiskCache.key('annotate-v1', llm.model, prompt);
  const cached = cache.get<Annotation>(key);
  if (cached) return cached;
  try {
    const res = await llm.complete({ system: SYSTEM, prompt, json: true, temperature: 0 });
    const parsed = AnnotationSchema.parse(extractJson(res.text));
    const out: Annotation = {
      isLogicBug: parsed.is_logic_bug,
      description: parsed.description.trim(),
      category: parsed.category,
      rejectReason: parsed.reject_reason ?? undefined,
      by: 'llm',
      model: llm.model,
    };
    cache.set(key, out);
    return out;
  } catch (e) {
    console.warn(`  annotate: LLM failed (${(e as Error).message.slice(0, 120)}), using heuristic`);
    return fallback;
  }
}
