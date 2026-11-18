import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Content-addressed JSON cache on disk. Keys hash everything that affects the output
 * (reviewer id incl. model + prompt version, the diff, ...), so a changed prompt never
 * returns a stale result, and re-running a report costs zero API calls.
 */
export class DiskCache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  static key(...parts: string[]): string {
    const h = createHash('sha256');
    for (const p of parts) h.update(p).update('\0');
    return h.digest('hex').slice(0, 32);
  }

  private path(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  get<T>(key: string): T | undefined {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    writeFileSync(this.path(key), JSON.stringify(value, null, 2));
  }
}
