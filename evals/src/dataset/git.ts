import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Clone (or reuse) a public repo. Uses plain git over HTTPS, which works even when the REST API is blocked. */
export function ensureClone(reposDir: string, repo: string): string {
  mkdirSync(reposDir, { recursive: true });
  const dir = join(reposDir, repo.replace('/', '__'));
  if (!existsSync(join(dir, '.git')) && !existsSync(join(dir, 'HEAD'))) {
    execFileSync('git', ['clone', '-q', '--no-checkout', `https://github.com/${repo}.git`, dir], { stdio: 'inherit' });
  }
  return dir;
}

export interface CommitInfo {
  sha: string;
  subject: string;
  body: string;
  date: string;
  parents: string[];
}

const FS = '\x1f';
const RS = '\x1e';

export function firstParentLog(dir: string, rev = 'HEAD'): CommitInfo[] {
  const out = git(dir, ['log', '--first-parent', `--format=%H${FS}%P${FS}%aI${FS}%s${FS}%b${RS}`, rev]);
  return parseLog(out);
}

export function parseLog(out: string): CommitInfo[] {
  return out
    .split(RS)
    .map((s) => s.replace(/^\n/, ''))
    .filter((s) => s.trim().length > 0)
    .map((s) => {
      const [sha = '', parents = '', date = '', subject = '', body = ''] = s.split(FS);
      return { sha, parents: parents.split(' ').filter(Boolean), date, subject, body: body.trim() };
    });
}

export function commitInfo(dir: string, sha: string): CommitInfo {
  const [c] = parseLog(git(dir, ['show', '-s', `--format=%H${FS}%P${FS}%aI${FS}%s${FS}%b${RS}`, sha]));
  if (!c) throw new Error(`commit not found: ${sha}`);
  return c;
}

export interface BlameLine {
  sha: string;
  origFile: string;
  origLine: number;
  boundary: boolean;
}

/** `git blame --porcelain` for a line range, ignoring whitespace changes (-w), following moves within a file (-M). */
export function blameRange(dir: string, rev: string, file: string, start: number, end: number): BlameLine[] {
  const out = git(dir, ['blame', '-w', '-M', '--porcelain', '-L', `${start},${end}`, rev, '--', file]);
  return parsePorcelain(out);
}

export function parsePorcelain(out: string): BlameLine[] {
  const res: BlameLine[] = [];
  const files = new Map<string, string>();
  const boundaries = new Set<string>();
  const lines = out.split('\n');
  let cur: { sha: string; origLine: number } | null = null;
  for (const l of lines) {
    const hm = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/.exec(l);
    if (hm) {
      cur = { sha: hm[1]!, origLine: Number(hm[2]) };
      continue;
    }
    if (!cur) continue;
    if (l.startsWith('filename ')) files.set(cur.sha, l.slice(9));
    else if (l === 'boundary') boundaries.add(cur.sha);
    else if (l.startsWith('\t')) {
      res.push({ sha: cur.sha, origLine: cur.origLine, origFile: files.get(cur.sha) ?? '', boundary: boundaries.has(cur.sha) });
      cur = null;
    }
  }
  return res;
}
