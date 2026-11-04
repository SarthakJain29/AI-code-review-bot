# Progress

## Roadmap (rough, will change)
0. Big picture: flow, components, why each exists
1. Hello webhook: GitHub App + receive a PR webhook locally + verify signature
2. End-to-end dumb version: webhook → fetch diff → LLM → post one comment (no queue)
3. Add a queue (Redis + BullMQ) + worker; retries, idempotency
4. Persistence (Postgres): installations, reviews, comments
5. Dashboard (Next.js): history, settings, usage
6. Production concerns: rate limits/quotas, cost tracking, observability, Docker
7. Repo context (pgvector embeddings), load testing, scaling

## Current step
Phase 1 — create GitHub App, receive a PR webhook locally.
Next session: test repo → smee channel → create App (PR r/w, contents r, PR events, secret) → private key → install → open PR, inspect Recent Deliveries.

## Done
- Phase 0: big picture flow, async ack idea, picked Gemini

## Open questions
- (resolved) Framework → Express, see DECISIONS
- If server crashes mid-review, what happens to it? (→ Phase 3)

## Written by Claude — revisit by hand
-

## Topics learned
- Bot flow: webhook → fetch diff → LLM → post comments via API
- Webhook signature = HMAC-SHA256(secret, body), secret never sent
- Ack fast, work async (webhook ~10s timeout)
- GitHub App vs OAuth App vs PAT vs Actions
- Serverless vs long-running server
- Webhook timeouts (GitHub 10s, no auto-retry) → retries cause duplicates → need idempotency (details in Phase 3)
- Dedupe keys: X-GitHub-Delivery (same delivery) + (repo, PR, head SHA) (same work); store atomically (Redis SET NX / DB unique)
