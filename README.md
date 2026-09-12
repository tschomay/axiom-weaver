# Axiom Weaver

The Dynamic Novel Compiler. A story is authored once as a structured **Story Package** and
*performed* into prose on every read — same story, told uniquely each time.

Start with [`CONTEXT.md`](./CONTEXT.md) for the ubiquitous language,
[`docs/schema/story-package.md`](./docs/schema/story-package.md) for the schema, and
[`docs/adr/`](./docs/adr/) for the decisions behind it. Agent setup is in
[`AGENTS.md`](./AGENTS.md).

## Why this exists

Most story-generation systems either replay a fixed script or freewheel from a prompt with no
memory of what's already true or already told — producing dead repetition at one extreme and
self-contradiction at the other, especially past a few thousand words. Axiom Weaver treats a story
as a **compiled artifact** instead: an author writes it once, completely and precisely, as
structured data — a Story Package — and a compiler *performs* it into prose on every read. The
plot, the facts, and the beats the author actually specified stay fixed across readings; only what
they left unspecified — phrasing, imagery, micro-beat order — is free to vary. Same story, told
uniquely each time.

The mechanism rests on keeping separate two things most story engines collapse into one memory:
**what is true in the world** (the World Model) and **what the reader has been told, and when**
(the told-ledger). That divergence is what makes secrets and dramatic irony possible instead of
accidental. Every engine write is also tiered by what kind of fact it touches — physical and
epistemic facts commit automatically, but volitional ones (goals, feelings, allegiances) can only
be *proposed* — so the model can't quietly rewrite a character's motivations while still being
free to phrase a scene differently each time. A plant-obligation walk, a continuity pass, and a
variance contract then catch what a naive re-run would get wrong: dropped setups, contradicted
facts, and recycled imagery.

**The paradigm** is three layers instead of the usual two: the author owns the **Fabula** (the
world and its events) and the **Syuzhet** (the arrangement — what scene shows what, in what
order); the engine owns only the **Performance** — the actual sentences. The author writes the
score; the engine performs it, the way an actor performs a fixed script differently each night.
See [`GLOSSARY.md`](./GLOSSARY.md) for every non-standard term this project uses, and
[`CONTEXT.md`](./CONTEXT.md) for the canonical ubiquitous language they're drawn from.

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
| The Manuscript: the author's mutable working copy, seeded three ways, published once | `src/schema/manuscript.ts`, `src/authoring/manuscript.ts` | ADR 0017 §1–§3, §5 |
| The package linter: errors that block a publish, warnings that never do | `src/authoring/lint.ts` | ADR 0017 §4 |
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
| The run report, its cross-run aggregation by Scene Card, the wall-clock estimate, the after-the-fact dollar cost | `src/edition/run-report.ts` | ADR 0014 §5/§6/§8 |
| The Working Draft: field-scoped digest diff, blunt staleness propagation | `src/draft/working-draft.ts` | ADR 0015 §1/§3 |
| Comparing two tellings of one `package_version` — digest fields, volitional divergence, both performances | `src/edition/edition-diff.ts` | ADR 0015 §6 |
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
| `cinderella` | 14 | Public domain (Lang/Perrault). The scale test: rollup windows close, staleness propagates a long way, and a whole live telling is 14–28 writer requests. |
| `a-christmas-carol` | 20 | Public domain (Dickens). The longest, with real length-budget pressure — the fixture most likely to produce a degraded scene. |
| `the-dragon-of-thistlewick` | 3 | Original. The shortest package here: a village commissions a knight to slay a dragon who turns out to keep bees. Three scenes, so a whole live telling costs three writer requests. |
| `the-amber-cat` | 4 | Original. A heist: the thief, the gala, the swap, and the four minutes the escape turns on. Carries two plants collected by one scene, and two author-asserted volitional columns that land in the proposals queue. |
| `the-lamp-at-cairn-head` | 5 | Original. A relief keeper takes over a lighthouse whose last keeper vanished. Holds one fact back across four scenes with `must_stay_hidden` and pays it off in the fifth, alongside a seed-grounded payoff (`plant: null`). |

The three short packages exist because the two long ones are still expensive to iterate on: one
telling of Cinderella is 14–28 writer requests (see [`AGENTS.md`](./AGENTS.md)) — real money, and
allowance on a key without infinite headroom. A three-scene story costs three, which is the
difference between running the compiler occasionally and running it after every edit.

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

With `GEMINI_API_KEY` set it makes a **real** call to `gemini-3.8-flash`. Without one it replays a
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

### Comparing two tellings

```bash
npm run compare -- cinderella                       # the story's two most recent finished runs
npm run compare -- <runIdA> <runIdB>
npm run compare -- cinderella --prose 13            # …and read scene 13 from both
```

Same story, told uniquely each time is the whole proposition, and this is where it stops being a
claim: the Scene Digest fields that came out differently per scene, the volitional columns the two
runs resolved differently (ADR 0005 §4 grants exactly that freedom), and both performances to read.
A pair has to share a `package_version` — a cross-version comparison asks what an author's *edit*
did, which is the Working Draft's staleness, not generation variance.

`npm run telling` is what pressing "generate a new telling" does, minus the button. It mints a
fresh run id, compiles every scene in order, flushes each one to Blob before the next starts, and
prints the run report: per-scene calls, diagnostics, continuity repairs, degraded scenes, the run's
soft budget, and what the run actually cost in dollars — computed after the fact from the tokens
each call spent, never estimated up front (ADR 0014 §5 keeps the pre-generation estimate wall-clock
only). The edition lands at `edition/{runId}/`.

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
| `/stories/{storyId}/diff` | **Compare two tellings** of the same `package_version`: per scene, the Scene Digest fields that came out differently, the volitional proposals the two runs resolved differently, and both performances to read side by side. Never a line-level text diff of prose — two performances of one Scene Card share almost no words. |
| `/stories/{storyId}/read` | The reader's three-way choice (ADR 0014 §3): the **Baked** edition, the **library** of tellings the author saved under names worth telling apart, or **generate a telling** — the whole compiler behind one button: a fresh run id, one writer call per scene in order, scene-count progress while it runs, and the finished edition as prose. Every completed telling stays readable and shareable by its own run id whether or not it is in the library. |
| `/stories/{storyId}/edit` | The **Manuscript** (ADR 0017): metadata, the Voice Card, the World Model seed, and the Scene Cards. Every edit autosaves into a per-story draft that nothing else can see, carrying the `updated_at` it was read at so a second tab is refused rather than silently discarded. The linter runs continuously beside it, and every problem is a link to the field that owns it. **Publish** names the `package_version` it is about to write and says that the bump will flag the Working Draft stale; **discard** drops the draft and returns the story to its published package. |
| `/stories/new` | Start a story **from scratch**, **duplicate** any retained version of any story under a new `story_id` — which is what makes the five fixtures usable as templates: only the package travels, so the copy has no Working Draft, no runs and no editions — or **import** a package as JSON. |

An author never types an id: `pov`, `location_id`, relationship endpoints and every other entity
reference is a picker over the World Model seed, because the errors hand-authoring actually
produces are cross-reference errors and a picker cannot produce one. `entry_state` and `exit_state` are
edited as rows — entity → column → value — with the column list read from `src/schema/tiers.ts`
and each column's **P / E / V** tier shown in the picker, so asserting `goal` reads as the
volitional assertion it is at the moment it is asserted. The reserved `_new_relationships` and
`_new_character_knowledge` keys are "create a row this scene makes" buttons rather than keys to
know about. A `pays_off` entry picks its plant from **earlier scenes only**, each labelled with
whether it actually declares the fact, because ADR 0004 rejects the pair if it does not — and
deleting a card that something plants at says so before the delete, not after.

**Import and export** is the escape hatch, and the reason the forms above are allowed to stay
narrow: an authoring gap is never a dead end. Export writes the same JSON the fixtures are written
in — two spaces, one trailing newline — so an exported retained version is byte-for-byte what the
store holds, and export → import → export is byte-identical for all five fixtures,
`_authoring_conventions` and every other block the schema has never heard of included. Import goes
through the linter before anything is saved and lands in the **Manuscript**, never in a retained
version: a second path to a published package would be a path around the publish gate. A package
with broken references imports anyway and reports its problems — a half-broken import you can fix
in the editor beats a rejection that leaves you holding a text file. A `bag` is flat key/value
rows whose value types are text, number, true/false, list and empty — Principle 4's "no nested
objects" is enforced by the control having no way to express one, not by a rule the author has to
remember. Desktop puts the section list and the editor side by side; a narrow viewport stacks them
into a drill-down where the open section is the URL and the back gesture is the way out.

The Working Draft has the same two moves at author-time: **Compile the rest** builds every card the
draft has not reached yet, in order, keeping each card's own diagnostics in a summary rather than
letting the next card bury them; **Read the draft** shows what has been built end to end. Compiling
a whole story a card at a time and generating a telling are different things — the first is
stepwise, keeps a Working Draft, and waits for the author on a volitional proposal; the second is
unattended and produces an immutable edition (`CONTEXT.md`, Compile occasions).

Compiling, resolving a proposal and promoting a run are writes, and ADR 0015 §5 keeps them to the
author. A deployment asks for the same `BLOB_READ_WRITE_TOKEN` every other write surface uses; a
local filesystem-backed instance has no shared store to protect and asks for nothing.

A compile calls the writer model, which costs money and, on a rate-limited key, spends allowance
(see [`AGENTS.md`](./AGENTS.md) — the project's key now has billing attached, which lifts the free
tier's ceiling by orders of magnitude, but a call is never free). So the Working Draft carries a
**compose from the Scene Card** toggle: the stand-in writer exercises validation, the continuity
pass and staleness without a model call. The compile view always names which of the two wrote the
scene.

A telling runs inside the server process that started it, so a restarted dev server — or a
serverless invocation that returns and takes the un-awaited loop with it — ends a run without it
ever reaching its own failure path. `status` would go on saying `running` for good, so the manifest
records when the run last reported and the Read screen stops believing a run it has not heard from:
it says the run stopped reporting, says how far it got, and offers a fresh telling rather than a
progress bar that never moves. A leftover run from an earlier visit can be picked back up from the
tellings list.

If a quota does run out — rarer now that the key is billed, but the writer model and its capacity
fallback still share one bucket — neither surface fails outright: `gemini-3.5-flash-lite` has its
own, separate one, so the compile view and the Read screen **offer** it and wait. A named model is
something the author asks for, never something the compiler reaches for on their behalf, because a
silent quality downgrade is worse than a wait. Whatever the light model writes is recorded as
written by it, and every run report shows what it actually cost (`/runs`) — the number now sits
next to the token counts it is computed from, not just implied by them.

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
| `POST /api/tellings/{runId}/library` | save or rename a finished telling in the story's library (author-gated) |
| `DELETE /api/tellings/{runId}/library` | take it off that list — never off the shelf; the run id keeps working (author-gated) |
| `GET /api/stories/{storyId}/draft` | the Working Draft's scene list: compiled-against version, staleness and its diff, what can be compiled next |
| `POST /api/stories/{storyId}/draft/compile` | compile one Scene Card into the Working Draft; `{"writer":"stand_in"}` composes from the card instead of calling the model (author-gated) |
| `POST /api/stories/{storyId}/proposals/{sequence}` | accept or reject one volitional proposal (author-gated) |
| `GET /api/stories/{storyId}/inspector?scene=N` | both inspector tabs at one scrubber position |
| `GET /api/stories/{storyId}/run-report` | every run of a story, aggregated by Scene Card, with each run's promotability |
| `GET /api/stories/{storyId}/diff?a={runId}&b={runId}` | two tellings of one `package_version` set beside each other |
| `GET /api/tellings/{runId}/report` | one run's full report |
| `GET /api/author/session` | whether this instance wants a token before offering a write |
| `GET /api/stories/{storyId}/manuscript` | the Manuscript, its lint result, and the version a publish would write |
| `PUT /api/stories/{storyId}/manuscript` | save; carries the `updated_at` it was read at, refused with a 409 if the stored copy moved on (author-gated) |
| `DELETE /api/stories/{storyId}/manuscript` | discard — the story returns to its published package (author-gated) |
| `POST /api/stories/{storyId}/manuscript/publish` | strict-parse → lint → `max(retained) + 1` → retain → repoint; a rejection returns the lint result and writes nothing (author-gated) |
| `POST /api/manuscripts` | start one: `{"source":"new"\|"edit"\|"duplicate"}` (author-gated) |
| `POST /api/authoring/lint` | lint a package body without saving — what the import path validates against |
| `GET /api/authoring/story-id-available?id=` | whether a `story_id` is free |
| `GET /api/stories/{storyId}/draft/scenes` | the Working Draft's prose, in order, however far it has been built |

`POST /api/stories/{storyId}/tellings` takes the same `{"writer":"stand_in"}` choice the author-time
compile does.
