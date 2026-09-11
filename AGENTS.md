## Agent skills

### Issue tracker

Issues live as GitHub Issues on this repo, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root, created lazily as terms and decisions resolve. See `docs/agents/domain.md`.

## The Gemini API key

`GEMINI_API_KEY` in this project is a **free-tier** key, and the tier — not the code — is the
binding constraint on live work. Limits as of September 2026, reported by the repo owner
(per-model figures are published in AI Studio rather than the docs, so read them live before
trusting these):

| | `gemini-3.7-flash` / `gemini-3.6-flash` | `gemini-3.5-flash-lite` |
| --- | --- | --- |
| Requests per minute | 5 | 15 |
| Requests per day | **20** | 500 |
| Tokens per minute | 250,000 | 250,000 |

**Requests are what run out; tokens are not.** A 14-scene telling is 14–28 writer calls, so one
full live run of the Cinderella fixture spends a whole day's allowance on the writer models — and
the first one did exactly that, dying at scene 8 on a `429`. TPM has never come close, which is
why `maxOutputTokensFor` reserves generously rather than tightly: a cap is a ceiling, not a
charge, and a second call costs 5% of the day.

Before spending live calls, know which you need:

- **Proving the mechanism works** — use the stand-in writer (no key: `npm run telling` composes
  every scene from its Scene Card) or, if the calls themselves matter,
  `AXIOM_WRITER_MODEL=gemini-3.5-flash-lite` / `npm run telling -- <fixture> --model
  gemini-3.5-flash-lite`. Twenty-five times the daily headroom, and prose you must not judge the
  project by.
- **Judging the prose** — that needs `gemini-3.7-flash`, and therefore needs the budget. Plan the
  run, don't discover halfway through that it is gone.

Two things that make a rate-limited key go further:

- **`AXIOM_REQUESTS_PER_MINUTE`** paces requests client-side instead of discovering the per-minute
  limit with a `429` that costs one of the day's 20. Set it to the key's own RPM.
- **`models.countTokens` is not on the generate quota.** It answers normally on a key whose
  `generateContent` allowance is spent, which makes any question about prompt size — schema cost,
  cache-prefix size, whether the payload has grown — answerable on a day when nothing else is.
  `npm run cache-check -- <story> --count-tokens` is the ready-made version.

**If the rate limit is blocking real work, say so and ask the owner to add billing.** Tier 1 is
instant on adding a billing account (`docs/research/gemini-capabilities.md` §6) and lifts these
limits by orders of magnitude. Ask rather than working around it with a weaker model, and never
degrade the writer model silently to dodge a quota — a run report that does not say which model
wrote a scene is worse than a run that did not happen.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
