# Axiom Weaver

The Dynamic Novel Compiler. A story is authored once as a structured **Story Package** and
*performed* into prose on every read — same story, told uniquely each time.

Start with [`CONTEXT.md`](./CONTEXT.md) for the ubiquitous language,
[`docs/schema/story-package.md`](./docs/schema/story-package.md) for the schema, and
[`docs/adr/`](./docs/adr/) for the decisions behind it. Agent setup is in
[`AGENTS.md`](./AGENTS.md).

## What is built

The compiler, end to end: the persistence half, the writer call, the loop that drives one call per
scene into a whole persisted edition, and the four author surfaces over all of it. Everything below
is reachable from a script, an API route, and — for the four surfaces ADR 0016 settled on — a
screen.

### Persistence and state

| Area | Where | Fixed by |
| --- | --- | --- |
| Story Package envelope, World Model tables, Scene Card | `src/schema/story-package.ts` | `docs/schema/story-package.md` |
| Per-column write-authority tiers (P / E / V) | `src/schema/tiers.ts` | ADR 0001 |
| The normalized `state_updates` shape | `src/schema/state-update.ts` | ADR 0005 |
| The World Model tables | `src/world-model/world-model.ts` | ADR 0001 |
| The state-update commit log and "as of scene N" replay | `src/world-model/state-log.ts` | ADR 0016 §2 |
| State-update authority: entry check, accept/reject/flag, proposals | `src/validator/state-update-authority.ts` | ADR 0005, ADR 0016 §3 |
| Diagnostics and their surfaces | `src/validator/diagnostics.ts` | ADR 0005 §5, ADR 0016 §4 |
| Blob layout, retained `package_version` snapshots | `src/persistence/` | ADR 0015 §2/§4 |
| Fixture loading and cross-reference checking | `src/fixtures/load.ts` | — |

What loading the two fixtures through all of it turned up is in
[`docs/schema/fixture-conformance-findings.md`](./docs/schema/fixture-conformance-findings.md).

### The writer call

| Area | Where | Fixed by |
| --- | --- | --- |
| Scene Digest shape and the told-ledger | `src/digest/scene-digest.ts`, `src/digest/told-ledger.ts` | ADR 0003, 0009, 0010 |
| Recursive zoom-level hierarchy (Scene → Chapter → Part → Book `L3+`) | `src/digest/hierarchy.ts` | ADR 0008 §1/§7 |
| Plant-and-payoff obligation walk | `src/plants/obligation-walk.ts` | ADR 0004 |
| Voice Card, five style presets, imagery ledger | `src/voice/` | ADR 0007, ADR 0010 |
| Re-anchoring bands (introduce / assume / reanchor / reintroduce) | `src/assembler/reanchoring.ts` | ADR 0009 |
| Deterministic join, payload order, cache boundaries, tail eviction | `src/assembler/` | ADR 0008 §3/§4/§6 |
| Output schema, contract prose, instruction layering | `src/writer/response-schema.ts`, `src/writer/contract.ts` | ADR 0012 §1/§2 |
| The wire adapter, and the recorded stand-in for it | `src/writer/model-client.ts` | Gemini research §5/§7 |
| Truncation salvage, digest-only fallback, per-finish-reason retries | `src/writer/compile-scene.ts`, `src/writer/salvage.ts` | ADR 0012 §5/§6, ADR 0013 |
| Variance-contract checks against the digest | `src/variance/variance-contract.ts` | ADR 0006 |
| Assembled-prompt debug view | `src/writer/debug-view.ts` | ADR 0008's own cache-ordering measurement |
| Cacheable-prefix walk, and whether it survives a scene | `src/assembler/cache-prefix.ts` | ADR 0008 §3, issue #50 |
| Backoff with jitter, `Retry-After`, quota-aware 429s, pacing, timeouts | `src/writer/model-client.ts` | measured against the live API |

### The run loop

| Area | Where | Fixed by |
| --- | --- | --- |
| The continuity pass: three digest-detectable modes, two repair shapes, field-level edit authority | `src/continuity/continuity-pass.ts` | ADR 0011 |
| The run loop: one step per scene, scene-boundary flush, progress, stall offer, degraded marking | `src/edition/run-loop.ts` | ADR 0014 §1–§7 |
| Compiled edition documents, run index, Baked pointer | `src/edition/edition.ts`, `src/persistence/story-repository.ts` | ADR 0015 §4 |
| The run report, its cross-run aggregation by Scene Card, the wall-clock estimate | `src/edition/run-report.ts` | ADR 0014 §5/§6/§8 |
| The Working Draft: field-scoped digest diff, blunt staleness propagation | `src/draft/working-draft.ts` | ADR 0015 §1/§3 |
| Author-time stepwise compiling into the draft | `src/draft/draft-compile.ts` | ADR 0011 §2, ADR 0016 §3 |
| Manual Baked promotion, refused for a degraded run | `StoryRepository.promoteToBaked` | ADR 0014 §9 |

### The author surfaces

| Area | Where | Fixed by |
| --- | --- | --- |
| Working Draft scene list, staleness, what can be compiled next | `src/draft/draft-view.ts` | ADR 0015 §1/§3, ADR 0016 §1 |
| "State as of scene N" for both memories — World Model and told-ledger | `src/draft/inspector.ts` | ADR 0016 §1/§2 |
| Accepting or rejecting a volitional proposal at author-time | `src/draft/proposals.ts` | ADR 0016 §3 |
| The run report as a screen: per-card aggregation, promotability | `src/edition/report-view.ts` | ADR 0014 §8/§9, ADR 0016 §1 |
| Recognizing the author on a write surface | `src/admin/authorize.ts` | ADR 0015 §5 |
| The screens themselves | `app/stories/[storyId]/` | ADR 0016 §1 |

## The fixtures

Five Story Packages, in two groups.

| Fixture | Scenes | What it is for |
| --- | --- | --- |
| `cinderella` | 14 | Public domain (Lang/Perrault). The scale test: rollup windows close, staleness propagates a long way, a whole live telling is a day's worth of writer requests. |
| `a-christmas-carol` | 20 | Public domain (Dickens). The longest, with real length-budget pressure — the fixture most likely to produce a degraded scene. |
| `the-dragon-of-thistlewick` | 3 | Original. The shortest package here: a village commissions a knight to slay a dragon who turns out to keep bees. Three scenes, so a whole live telling costs three writer requests. |
| `the-amber-cat` | 4 | Original. A heist: the thief, the gala, the swap, and the four minutes the escape turns on. Carries two plants collected by one scene, and two author-asserted volitional columns that land in the proposals queue. |
| `the-lamp-at-cairn-head` | 5 | Original. A relief keeper takes over a lighthouse whose last keeper vanished. Holds one fact back across four scenes with `must_stay_hidden` and pays it off in the fifth, alongside a seed-grounded payoff (`plant: null`). |

The three short packages exist because the two long ones are expensive to iterate on: a free-tier
key carries twenty writer requests a day (see [`AGENTS.md`](./AGENTS.md)), and one telling of
Cinderella spends all of them. A three-scene story costs three, which is the difference between
running the compiler once a day and running it after every edit.

## Running it

```bash
npm install
npm run load-fixtures   # retain every fixture Story Package
npm run dev             # http://localhost:3000
```

`npm test` runs the suite; `npm run typecheck` and `npm run lint` are the other two fast checks.

### Compiling a scene

```bash
npm run compile-scene                      # both fixtures
npm run compile-scene -- cinderella --verbose
```

This assembles the full prompt for one scene, makes the writer call, validates what comes back
through the state-update authority validator, and prints the debug view: each payload segment with
its cache mechanism and size, the volatile tail's eviction order, the re-anchoring bands, and every
diagnostic raised.

With `GEMINI_API_KEY` set it makes a **real** call to `gemini-3.7-flash`. Without one it replays a
**recorded stand-in** from `fixtures/recorded/`, and says which of the two it did on every run.
Those recordings are hand-written, not captured model output — see the `_note` at the top of each
file. No scene in this repository has yet been generated by a real model.

### Generating a telling

```bash
npm run telling                            # cinderella, the whole loop end to end
npm run telling -- the-dragon-of-thistlewick   # three scenes, three writer requests
npm run telling -- a-christmas-carol --verbose
npm run telling -- cinderella --promote    # …and promote the run to Baked
npm run run-report -- cinderella           # every run of a story, aggregated by Scene Card
```

`npm run telling` is what pressing "generate a new telling" does, minus the button. It mints a
fresh run id, compiles every scene in order, flushes each one to Blob before the next starts, and
prints the run report: per-scene calls, diagnostics, continuity repairs, degraded scenes, and the
run's soft budget. The edition lands at `edition/{runId}/`.

With `GEMINI_API_KEY` set every scene is a real writer call. Without one a **stand-in writer**
answers from the Scene Cards themselves — enough to exercise validation, the continuity pass,
rollups and the flush, and no more; every call it makes reports zero tokens, which is how a run
report says that nothing was called.

### Checking the cache

```bash
npm run cache-check                                 # cinderella, offline estimates
npm run cache-check -- cinderella --count-tokens    # real token counts, needs a key
```

Caching is a prefix match, so ADR 0008's payload order only pays off while each scene's stable
prefix survives into the next scene's prompt — and an ordering mistake is invisible in the prose,
showing up live only as `cachedContentTokenCount` staying at zero. This asks both questions that
decide a cache hit: does the prefix survive (a reset at a rollup is expected; anywhere else is a
bug), and does it clear the model's 4,096-token minimum. `--count-tokens` uses `models.countTokens`,
which generates nothing and works on a key whose generate quota is spent.

The ordering half is also a test (`tests/cache-prefix.test.ts`), so a reordering that breaks it
fails the suite rather than a novel-scale bill.

### Storage

Persistence goes through a `BlobStore` interface with two implementations. With
`BLOB_READ_WRITE_TOKEN` set, writes go to a private Vercel Blob store; without one they go to the
filesystem under `.data/` (gitignored) at exactly the same pathnames. See `.env.example` and
`src/persistence/paths.ts` for the layout.

### The screens

| Screen | What an author does there |
| --- | --- |
| `/stories/{storyId}` | The **Working Draft** and the **scene compile view**. Compile a card and read what it produced — the `error` and `warn` diagnostics named against the exact field each one contradicts, and the volitional proposals waiting on a decision. Stale badges sit inline on the scene list, each carrying ADR 0015 §6's field-scoped diff as its popover. |
| `/stories/{storyId}/inspector` | The **World & Discourse inspector**: the World Model and the told-ledger as two tabs over one scene-index scrubber, both reconstructed rather than stored. |
| `/stories/{storyId}/runs` | The **run report**: every run aggregated by Scene Card — "this card degraded on 4 of 20 reads" — and the manual promotion of a completed, non-degraded run to Baked. |
| `/stories/{storyId}/read` | **Generate a telling** — the whole compiler behind one button: a fresh run id, one writer call per scene in order, scene-count progress while it runs, and the finished edition as prose. Also reads back any telling the story has already produced. |

The Working Draft has the same two moves at author-time: **Compile the rest** builds every card the
draft has not reached yet, in order, keeping each card's own diagnostics in a summary rather than
letting the next card bury them; **Read the draft** shows what has been built end to end. Compiling
a whole story a card at a time and generating a telling are different things — the first is
stepwise, keeps a Working Draft, and waits for the author on a volitional proposal; the second is
unattended and produces an immutable edition (`CONTEXT.md`, Compile occasions).

Compiling, resolving a proposal and promoting a run are writes, and ADR 0015 §5 keeps them to the
author. A deployment asks for the same `BLOB_READ_WRITE_TOKEN` every other write surface uses; a
local filesystem-backed instance has no shared store to protect and asks for nothing.

A compile calls the writer model, and on the project's free-tier key one telling spends the whole
day's allowance (see [`AGENTS.md`](./AGENTS.md)). So the Working Draft carries a **compose from the
Scene Card** toggle: the stand-in writer exercises validation, the continuity pass and staleness
without a model call. The compile view always names which of the two wrote the scene.

A telling runs inside the server process that started it, so a restarted dev server — or a
serverless invocation that returns and takes the un-awaited loop with it — ends a run without it
ever reaching its own failure path. `status` would go on saying `running` for good, so the manifest
records when the run last reported and the Read screen stops believing a run it has not heard from:
it says the run stopped reporting, says how far it got, and offers a fresh telling rather than a
progress bar that never moves. A leftover run from an earlier visit can be picked back up from the
tellings list.

When the day's allowance does run out, neither surface fails outright. The writer model and its
capacity fallback share one daily quota, and once both are gone no retry helps before midnight
Pacific — but `gemini-3.5-flash-lite` has its own, much larger one. So the compile view and the Read
screen **offer** it and wait: a named model is something the author asks for, never something the
compiler reaches for on their behalf, because a silent quality downgrade is worse than a rate limit.
Whatever the light model writes is recorded as written by it.

### Read surfaces

| Route | What it serves |
| --- | --- |
| `GET /api/stories` | every story with a retained package |
| `GET /api/stories/{storyId}/package` | the current Story Package, through the pointer |
| `GET /api/stories/{storyId}/package/{version}` | a retained snapshot — what an edition's pinned version dereferences to |
| `GET /api/stories/{storyId}/world-model?scene=N` | the World Model as of scene N, replayed from the commit log |
| `GET /api/stories/{storyId}/proposals` | the proposals queue: volitional proposals awaiting the author |
| `GET /api/stories/{storyId}/tellings` | the reader's three-way choice: the Baked edition, the story's runs, and a wall-clock estimate |
| `POST /api/stories/{storyId}/tellings` | generate a new telling — mints a fresh run id and starts the loop |
| `GET /api/tellings/{runId}` | one telling: scene-count progress while it runs, `?include=scenes` for the prose once it is finished |
| `POST /api/tellings/{runId}/promote` | promote a completed, non-degraded run to Baked (author-gated) |
| `GET /api/stories/{storyId}/draft` | the Working Draft's scene list: compiled-against version, staleness and its diff, what can be compiled next |
| `POST /api/stories/{storyId}/draft/compile` | compile one Scene Card into the Working Draft; `{"writer":"stand_in"}` composes from the card instead of calling the model (author-gated) |
| `POST /api/stories/{storyId}/proposals/{sequence}` | accept or reject one volitional proposal (author-gated) |
| `GET /api/stories/{storyId}/inspector?scene=N` | both inspector tabs at one scrubber position |
| `GET /api/stories/{storyId}/run-report` | every run of a story, aggregated by Scene Card, with each run's promotability |
| `GET /api/tellings/{runId}/report` | one run's full report |
| `GET /api/author/session` | whether this instance wants a token before offering a write |
| `GET /api/stories/{storyId}/draft/scenes` | the Working Draft's prose, in order, however far it has been built |

`POST /api/stories/{storyId}/tellings` takes the same `{"writer":"stand_in"}` choice the author-time
compile does.
