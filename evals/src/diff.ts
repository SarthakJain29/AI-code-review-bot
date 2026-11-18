/** Minimal unified-diff parser + helpers. No dependencies so it is easy to test. */

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  content: string;
  /** Line number in the old file (del/ctx). */
  oldLine?: number;
  /** Line number in the new file (add/ctx). */
  newLine?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  /** Raw text of this file's section of the diff, including the `diff --git` header. */
  raw: string;
  hunks: DiffHunk[];
  binary: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripPrefix(p: string): string | null {
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  const sections = text.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff --git '));
  for (const raw of sections) {
    const lines = raw.split('\n');
    const header = lines[0] ?? '';
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
    let oldPath: string | null = m?.[1] ?? null;
    let newPath: string | null = m?.[2] ?? null;
    const hunks: DiffHunk[] = [];
    let binary = false;
    let cur: DiffHunk | null = null;
    let oldNo = 0;
    let newNo = 0;
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i] ?? '';
      if (!cur) {
        if (l.startsWith('--- ')) oldPath = stripPrefix(l.slice(4).trim());
        else if (l.startsWith('+++ ')) newPath = stripPrefix(l.slice(4).trim());
        else if (l.startsWith('Binary files') || l.startsWith('GIT binary patch')) binary = true;
      }
      const hm = HUNK_RE.exec(l);
      if (hm) {
        cur = {
          oldStart: Number(hm[1]),
          oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
          newStart: Number(hm[3]),
          newLines: hm[4] === undefined ? 1 : Number(hm[4]),
          lines: [],
        };
        hunks.push(cur);
        oldNo = cur.oldStart;
        newNo = cur.newStart;
        continue;
      }
      if (!cur) continue;
      if (l.startsWith('+')) cur.lines.push({ type: 'add', content: l.slice(1), newLine: newNo++ });
      else if (l.startsWith('-')) cur.lines.push({ type: 'del', content: l.slice(1), oldLine: oldNo++ });
      else if (l.startsWith(' ')) cur.lines.push({ type: 'ctx', content: l.slice(1), oldLine: oldNo++, newLine: newNo++ });
      // "\ No newline at end of file" and trailing empty strings are ignored.
    }
    files.push({ oldPath, newPath, raw: raw.endsWith('\n') ? raw : raw + '\n', hunks, binary });
  }
  return files;
}

export function diffStats(files: DiffFile[]): { files: number; additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files)
    for (const h of f.hunks)
      for (const l of h.lines) {
        if (l.type === 'add') additions++;
        else if (l.type === 'del') deletions++;
      }
  return { files: files.length, additions, deletions };
}

const SOURCE_EXT = /\.(c|m)?(t|j)sx?$|\.vue$|\.svelte$/;
const NOISE_PATH =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|CHANGELOG\.md)$|(^|\/)(dist|build|coverage|__snapshots__|node_modules)\/|\.snap$|\.min\.js$|\.map$/;
const TEST_PATH = /(^|\/)(__tests__|tests?|test-d|__mocks__|e2e|fixtures?|benchmarks?|playground|examples?|docs?|scripts)\/|\.(test|spec|bench|test-d)\.[cm]?[jt]sx?$/;
const DTS = /\.d\.[cm]?ts$/;

export function isSourceFile(path: string): boolean {
  return SOURCE_EXT.test(path) && !TEST_PATH.test(path) && !NOISE_PATH.test(path) && !DTS.test(path);
}
export function isTestFile(path: string): boolean {
  return TEST_PATH.test(path);
}
export function isNoiseFile(path: string): boolean {
  return NOISE_PATH.test(path);
}

/** Drop lockfiles, snapshots, build output and binaries; keep everything a human reviewer would read. */
export function filterReviewableDiff(files: DiffFile[]): DiffFile[] {
  return files.filter((f) => !f.binary && !isNoiseFile(f.newPath ?? f.oldPath ?? ''));
}

export function renderDiff(files: DiffFile[]): string {
  return files.map((f) => f.raw).join('');
}

/** New-side line numbers that exist in the diff (added or context), per file. Used to validate comments. */
export function commentableLines(files: DiffFile[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const f of files) {
    if (!f.newPath) continue;
    const s = new Set<number>();
    for (const h of f.hunks) for (const l of h.lines) if (l.newLine !== undefined) s.add(l.newLine);
    out.set(f.newPath, s);
  }
  return out;
}

/** Render a diff with explicit new-side line numbers, which makes LLM line references far more accurate. */
export function renderNumberedDiff(files: DiffFile[]): string {
  const out: string[] = [];
  for (const f of files) {
    out.push(`=== FILE: ${f.newPath ?? f.oldPath} ${f.newPath === null ? '(deleted)' : f.oldPath === null ? '(new file)' : ''}`.trimEnd());
    for (const h of f.hunks) {
      out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
      for (const l of h.lines) {
        const no = l.newLine !== undefined ? String(l.newLine).padStart(5) : '     ';
        const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
        out.push(`${no} ${sign}${l.content}`);
      }
    }
  }
  return out.join('\n');
}
