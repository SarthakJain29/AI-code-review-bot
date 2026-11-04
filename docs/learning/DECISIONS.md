# Design decisions

Format: **Decision** · options · why · revisit when

- **LLM: Gemini free tier, behind a `reviewCode(diff)` wrapper** · Gemini / Groq / Ollama · free, good at code; wrapper keeps provider swappable · revisit when hitting free-tier limits or quality is poor
- **Ack webhook fast, review async** · do review inside the request / respond immediately and work in background · GitHub times out at ~10s, LLM takes 30–60s · revisit in Phase 3 (in-process background work is lost if the server crashes → queue)
- **Webhook server: Express (long-running Node process)** · Express / Fastify / Next.js API route on Vercel · needs to stay alive after 200 OK for background work; serverless can freeze/kill it; Express = familiar + huge ecosystem · revisit if perf matters (Fastify) or once a queue makes the receiver stateless
