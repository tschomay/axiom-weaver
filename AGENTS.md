## Agent skills

### Issue tracker

Issues live as GitHub Issues on this repo, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root, created lazily as terms and decisions resolve. See `docs/agents/domain.md`.

`README.md`'s "Why this exists" section and `GLOSSARY.md` are both derived from `CONTEXT.md`. When
a term is introduced, renamed, or has its meaning changed in `CONTEXT.md` (or a new ADR), update
both of them in the same change — the glossary is a quick-reference table over `CONTEXT.md`, not a
separate source of truth, and it drifts silently if it isn't touched alongside it.

## The Gemini API key

`GEMINI_API_KEY` in this project **has billing attached** (added September 2026). It was
free-tier before that, and the free tier's own ceiling — 5 requests/minute and a hard **20
requests/day** shared by `gemini-3.7-flash` and `gemini-3.6-flash`, 500/day for
`gemini-3.5-flash-lite` — is why so much of this codebase's retry, fallback and pacing machinery
exists (`WRITER_MODEL_FALLBACK`, `RequestPacer`, `dailyQuotaFailure`, the whole "day's allowance"
narrative in older comments and commit history). None of that ceiling applies anymore: adding
billing moves the key onto Tier 1, which lifts requests-per-day by orders of magnitude
(`docs/research/gemini-capabilities.md` §6). **Don't trust a comment or doc line that still cites
"20 requests/day" or "free-tier" as the project's current state** — those describe history, not
today, unless they're explicitly framed as a measurement from a specific past run.

A paid tier is not limit-free, though: RPM, TPM and a **spend-based** cap (Tier 1: $10 per
rolling 10-minute window) still apply, and per-model RPM/TPM figures are published live in AI
Studio rather than in the docs — read them there before assuming headroom for something unusually
large (a novel-scale read, a burst of concurrent runs). The mechanisms that used to exist purely
to survive the free tier — `AXIOM_REQUESTS_PER_MINUTE` pacing, the capacity-fallback swap, per-day
quota detection — are still correct and still worth using; they just fire far less often now.

**The lite model, `gemini-3.5-flash-lite`, stays in deliberate use for testing — not because a
quota forces it anymore, but because it is far cheaper and faster than the writer model, which
makes it the right way to prove connectivity or a run-loop change actually reaches the API before
spending a real call on prose you intend to judge.** Set `AXIOM_WRITER_MODEL=gemini-3.5-flash-lite`
(`TESTING_WRITER_MODEL` in `src/writer/model-client.ts`), or `npm run telling -- <fixture> --model
gemini-3.5-flash-lite`. It remains opt-in only and is never selected automatically — a silent
quality downgrade is worse than a slower or costlier call, billing or no billing — and the run
report's per-call `model` field always records what actually wrote each scene.

For judging prose, use `WRITER_MODEL` (currently `gemini-3.8-flash`, Flash's current generation —
`gemini-3.7-flash` is the same-price capacity fallback). `gemini-3.8-flash` launched priced
identically to `gemini-3.7-flash` and `gemini-3.6-flash` (confirmed live against the pricing page
on 2026-09-12: `docs/research/gemini-capabilities.md` §6), so there is no cost reason to stay on
an older generation.

Two things that still make a call go further, billing or not:

- **`AXIOM_REQUESTS_PER_MINUTE`** paces requests client-side rather than discovering a per-minute
  limit with a `429`. Set it to the key's own RPM.
- **`models.countTokens` is not on the generate quota**, so it answers normally even if the
  generate-content allowance for a window is briefly spent — useful for any question about prompt
  size (schema cost, cache-prefix size, whether the payload has grown). `npm run cache-check --
  <story> --count-tokens` is the ready-made version.

Every run report now carries a dollar cost alongside its token counts (`src/edition/run-report.ts`,
`costForCalls`/`costForScenes`), computed from `MODEL_PRICING` at read time so a pricing change is
reflected in every report rather than needing a migration. If a genuine limit is still blocking
real work after billing, say so and ask the owner rather than degrading the writer model silently
to dodge it — a run report that does not say which model wrote a scene is worse than a run that
did not happen.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
