/** Measures how often the judge agrees with hand labels (dataset/judge-labels.json). */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { agreement } from '../scoring/metrics.js';
import { ReviewCommentSchema, type EvalCase } from '../types.js';
import type { JudgeValidation } from '../report/report.js';
import type { Judge } from './judge.js';

export const LabelFileSchema = z.object({
  description: z.string(),
  labeler: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      caseId: z.string(),
      /** "smoke-run" = real reviewer output; "constructed" = comment set written to probe the judge. */
      source: z.enum(['smoke-run', 'constructed']),
      comments: z.array(ReviewCommentSchema),
      /** Hand label: does any comment identify the known bug AND point at it (strict definition)? */
      caught: z.boolean(),
      note: z.string(),
    }),
  ),
});
export type LabelFile = z.infer<typeof LabelFileSchema>;

export function loadLabels(path: string): LabelFile {
  return LabelFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export async function validateJudge(judge: Judge, labels: LabelFile, cases: EvalCase[]): Promise<JudgeValidation & { items: { id: string; human: boolean; judge: boolean }[] }> {
  const pairs: { id: string; human: boolean; judge: boolean; note: string }[] = [];
  for (const item of labels.items) {
    const c = cases.find((x) => x.id === item.caseId);
    if (!c || c.kind !== 'buggy') {
      console.warn(`  skip label ${item.id}: case ${item.caseId} not found or not buggy`);
      continue;
    }
    const v = await judge.judge(c, item.comments);
    pairs.push({ id: item.id, human: item.caught, judge: v.caught, note: item.note });
  }
  return {
    judgeId: judge.id,
    agreement: agreement(pairs),
    disagreements: pairs.filter((p) => p.human !== p.judge),
    items: pairs.map(({ id, human, judge: j }) => ({ id, human, judge: j })),
  };
}
