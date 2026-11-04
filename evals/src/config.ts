import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATASET_PATH = join(ROOT, 'dataset', 'cases.json');
export const LABELS_PATH = join(ROOT, 'dataset', 'judge-labels.json');
export const CACHE_DIR = join(ROOT, '.cache');
export const RESULTS_DIR = join(ROOT, 'results');
export const REPORTS_DIR = join(ROOT, 'reports');

/** Load evals/.env if present (tiny parser, no dependency). Real env vars win. */
export function loadDotEnv(path = join(ROOT, '.env')): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const [, k, v] = m;
    if (k && process.env[k] === undefined) process.env[k] = v!.replace(/^['"]|['"]$/g, '');
  }
}
