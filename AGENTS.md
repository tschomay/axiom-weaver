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

**If the rate limit is blocking real work, say so and ask the owner to add billing.** Tier 1 is
instant on adding a billing account (`docs/research/gemini-capabilities.md` §6) and lifts these
limits by orders of magnitude. Ask rather than working around it with a weaker model, and never
degrade the writer model silently to dodge a quota — a run report that does not say which model
wrote a scene is worse than a run that did not happen.
