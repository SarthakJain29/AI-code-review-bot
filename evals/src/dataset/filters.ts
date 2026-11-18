/** Pure selection rules for the dataset builder (unit-tested). */
import type { BugCategory } from '../types.js';

export const PR_NUMBER_RE = /\(#(\d+)\)\s*$/;

export function prNumberFromSubject(subject: string): number | null {
  const m = PR_NUMBER_RE.exec(subject) ?? /^Merge pull request #(\d+)/.exec(subject);
  return m ? Number(m[1]) : null;
}

const FIX_RE = /^(fix|bugfix|hotfix)(\([^)]*\))?!?:\s|^fix(es|ed)?\s/i;
/** Fix commits that are not about runtime logic. */
const NON_LOGIC_RE =
  /\b(types?|typings?|typo|typos|docs?|readme|lint|eslint|prettier|deps?|dependenc(y|ies)|ci|build|bundl\w*|tests?|changelog|release|jsdoc|comments?|d\.ts|tsc|tsconfig|typescript|ts|inference|infer|generics?|overloads?|intellisense|style|css|format(ting)?|warning|deprecat\w*|devtools|playground|example)\b/i;

export function isFixCandidateSubject(subject: string): boolean {
  if (!FIX_RE.test(subject)) return false;
  if (prNumberFromSubject(subject) === null) return false;
  if (/\brevert\b/i.test(subject)) return false;
  return !NON_LOGIC_RE.test(subject);
}

const CLEAN_RE = /^(feat|perf|refactor)(\([^)]*\))?!?:\s/i;
export function isCleanCandidateSubject(subject: string): boolean {
  if (!CLEAN_RE.test(subject)) return false;
  if (prNumberFromSubject(subject) === null) return false;
  return !/\b(types?|typings?|docs?|deps?|ci|build|tests?|release|revert)\b/i.test(subject);
}

/** Introducing commits we refuse to blame (pure formatting/mechanical changes are not "the bug's PR"). */
export function isMechanicalSubject(subject: string): boolean {
  return /\b(format(ting)?|prettier|lint|eslint|style|rename|move files?|migrate to|monorepo|initial commit|release|chore\(deps\)|bump|wip|merge)\b/i.test(
    subject,
  );
}

/** Lines whose blame carries no signal (SZZ refinement: ignore blank / brace-only / comment lines). */
export function isTrivialLine(content: string): boolean {
  const t = content.trim();
  return t === '' || /^[{}()[\];,]*$/.test(t) || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/');
}

export interface BlamedLine {
  sha: string;
  origFile: string;
  origLine: number;
}

export interface IntroducerPick {
  sha: string;
  count: number;
  total: number;
  candidates: number;
}

/** SZZ majority vote: the commit that last touched most of the lines the fix changed. */
export function pickIntroducer(lines: BlamedLine[]): IntroducerPick | null {
  if (lines.length === 0) return null;
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.sha, (counts.get(l.sha) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const e of counts) if (!best || e[1] > best[1]) best = e;
  if (!best) return null;
  return { sha: best[0], count: best[1], total: lines.length, candidates: counts.size };
}

/** Merge line numbers into inclusive ranges, joining gaps of up to `gap` lines. */
export function toRanges(nums: number[], gap = 3): { start: number; end: number }[] {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const out: { start: number; end: number }[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n - last.end <= gap + 1) last.end = n;
    else out.push({ start: n, end: n });
  }
  return out;
}

const CATEGORY_RULES: [BugCategory, RegExp][] = [
  ['async-concurrency', /\b(race|async|await|promise|concurren\w*|timing|timeout|abort\w*|tick|schedul\w*|debounce|throttle|lifecycle|unmount\w*|mount\w*)\b/i],
  ['null-undefined', /\b(null|undefined|nullish|optional|missing|empty|falsy|not defined|cannot read)\b/i],
  ['type-coercion', /\b(typeof|instanceof|coerc\w*|NaN|string(ify)?|number|boolean|bigint|date object|isArray)\b/i],
  ['regex-string', /\b(regex|regexp|pattern|escape|encod\w*|decod\w*|parse|parsing|url|query ?string|whitespace|unicode|trim|split|path)\b/i],
  ['state-mutation', /\b(cache|cached|stale|mutat\w*|state|reactiv\w*|shared|leak|reset|clone|copy|immutable)\b/i],
  ['performance', /\b(perf|performance|slow|memory|infinite loop|quadratic|recursion)\b/i],
  ['api-contract', /\b(option|options|param\w*|argument|return\w*|header|config|signature|callback|export|api|response|request|status)\b/i],
  ['edge-case', /\b(edge|boundary|off.by.one|index|length|zero|negative|overflow|first|last|duplicate)\b/i],
];

export function heuristicCategory(text: string): BugCategory {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'logic';
}

/** "fix(router): handle trailing slash (#123)" -> "handle trailing slash" */
export function cleanSubject(subject: string): string {
  return subject
    .replace(PR_NUMBER_RE, '')
    .replace(/^(fix|bugfix|hotfix|feat|perf|refactor)(\([^)]*\))?!?:\s*/i, '')
    .trim();
}
