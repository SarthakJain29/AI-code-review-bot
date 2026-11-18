/**
 * Optional GitHub REST enrichment. Uses EVALS_GITHUB_TOKEN only (never GITHUB_TOKEN/GH_TOKEN,
 * which are reserved for pushing this repo). When the API is unreachable (e.g. a sandbox proxy
 * blocks api.github.com for repos outside the session), the builder works from git history alone.
 */
export interface PrMeta {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  mergedAt: string | null;
}

let apiAvailable: boolean | null = null;

function headers(): Record<string, string> {
  const token = process.env.EVALS_GITHUB_TOKEN;
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'diffwise-evals',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function probeGithubApi(repo: string): Promise<{ ok: boolean; status: number | null; message: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    apiAvailable = res.ok;
    return { ok: res.ok, status: res.status, message: res.ok ? 'ok' : body.slice(0, 200) };
  } catch (e) {
    apiAvailable = false;
    return { ok: false, status: null, message: (e as Error).message };
  }
}

export async function fetchPrMeta(repo: string, number: number): Promise<PrMeta | null> {
  if (apiAvailable === false) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { title: string; body: string | null; html_url: string; labels: { name: string }[]; merged_at: string | null };
    return { number, title: j.title, body: j.body ?? '', url: j.html_url, labels: j.labels.map((l) => l.name), mergedAt: j.merged_at };
  } catch {
    return null;
  }
}
