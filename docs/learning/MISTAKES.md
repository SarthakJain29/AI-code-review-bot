# Mistakes & misconceptions

Format: `YYYY-MM-DD — mistake → correct understanding`

- 2026-11-03 — Thought GitHub sends the webhook secret in a header → the secret is never sent. GitHub signs the body with HMAC-SHA256(secret, body) and sends the signature in `X-Hub-Signature-256`. We recompute and compare.
- 2026-11-03 — Assumed the webhook contains the PR code → it only has metadata (PR number, repo, SHAs). We must fetch the diff via GitHub API.
