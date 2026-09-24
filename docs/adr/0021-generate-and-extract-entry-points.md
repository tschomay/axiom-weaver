# ADR 0021: Generate and Extract reach the UI through Import, not a new persistence path

## Status

Accepted — settled in [Design: a fourth story-creation entry point — Generate (and later
Extract) — for UI-only use](https://github.com/tschomay/axiom-weaver/issues/171), filed because
the owner's only access to this deployment is a phone through the Vercel-hosted app, and
everything #142's waves built (extraction, segmentation, arc generation) is CLI-only and
therefore invisible to them.

## Context

[ADR 0017](0017-the-manuscript-and-publishing.md) §5 names three entry points into a Manuscript —
New, Edit, Duplicate — plus §6's import/export escape hatch, and §10 is explicit: a
model-proposed Scene Card source "is not built, and this ADR does not reopen the question."
#171 reopens it on purpose, because the pipelines that would feed such a source
(`src/arc/fabula.ts`'s `draftPackage`, `src/segmentation/segment.ts`'s `segmentFabulaPackage`,
`src/extraction/pipeline.ts`) now exist, are measured (`docs/agents/story-authoring-quality-approach.md`),
and produce exactly the `StoryPackage` shape the import path already accepts. Two child issues,
[#172](https://github.com/tschomay/axiom-weaver/issues/172) (Generate) and
[#173](https://github.com/tschomay/axiom-weaver/issues/173) (Extract), are filed with full build
detail and were waiting on this issue's five questions.

Also in scope: the durable-job pattern these UI flows need. `src/edition/run-loop.ts` +
`app/api/stories/[storyId]/tellings/route.ts` already solve "mint a run id, start a long job
un-awaited, let the client poll" for read-time tellings, but that loop is shaped entirely around
compiling *scenes* (a `StepRunner` per scene, an `EditionManifest`, a `RunReport` that aggregates
by Scene Card id, `RunState`'s digest hierarchy and told-ledger). Generate and Extract have no
scenes until segmentation runs, no told-ledger, no continuity pass — reusing `runTelling` itself
would mean bending a read-time abstraction around an author-time job it wasn't shaped for.

## Decision

### 1. Generate before Extract, confirmed

#171's own recommendation stands, unchanged: Generate (#172) is better-measured today (payoff
earned-ness fix in #170, unmeasured live but not a regression) and demonstrates the tool's actual
point — premise to story — where Extract (#173) is closer to a calibration/import utility and is
measurably the roughest of the three pipeline stages
(`docs/agents/story-authoring-quality-approach.md` §11 and #171's own summary). No new evidence
changes this; #172 and #173 stay independently buildable in that order.

### 2. This needed an ADR

#171 asked whether the entry-point question needs a full ADR or a lightweight decision recorded
in the issue. It needs the ADR: this decision explicitly reopens and narrows ADR 0017 §10's
closed door, and it fixes a durable-job pattern two future tickets build against. That is real
teeth, unlike a schema-level judgment call (contrast [ADR 0020](0020-plant-payoff-trigger-term.md),
which added a lint warning with no persistence-shape consequences).

### 3. Generate and Extract are UI entry points, not persistence entry points

"Generate" and "Extract" become a fourth and fifth tab on `/stories/new`, alongside New /
Duplicate / Import (`app/stories/new/new-story-view.tsx`). But neither writes a Manuscript
directly. Each runs a pipeline to completion, producing a `StoryPackage`, and hands it to the
**existing, unmodified** `createFromImport` flow the Import tab already uses today: `POST
/api/manuscripts` with `source: 'new'`, then `PUT .../manuscript` with the produced package. The
Manuscript/publish machinery (ADR 0017 §§2–4), the linter, and the picker-based editor need zero
changes.

This is deliberately a *smaller* amendment than what ADR 0017 §10 speculated — a model proposing
individual Scene Cards at the editor's card-source seam (`blank` / `duplicated-from`, plus a
third). That seam stays unbuilt; §10's exclusion of *procedural, per-card* generation is not
reopened. What's decided here is coarser and mechanical: a whole package, produced once,
reviewed once, imported once — the same shape a hand-exported JSON file already takes through
§6's escape hatch, just produced by a pipeline instead of a text editor.

### 4. A new, narrower durable-job abstraction — not `runTelling`, but sharing its seam

Generate and Extract get their own job type, distinct from a Compiled edition/telling run:

- **Reused as-is**: the `StepRunner` type and `inlineStepRunner` (`src/edition/run-loop.ts`) —
  already generic over `<T>` with no coupling to scenes — and the mint-id / `202` + `run_id` +
  `status_path` / poll-`GET` HTTP shape the tellings route established. Promote `StepRunner` to
  a shared module (e.g. `src/edition/step-runner.ts`) so both the read-time run loop and this new
  job type import the same seam rather than two copies.
- **Not reused**: `EditionManifest`, `RunReport`, `RunState` and everything scene-shaped. An
  Authoring run (§5, below) gets its own manifest with pipeline **stages** instead of scenes —
  `brief` → `draft_events` → `segment` for Generate; `entities` → `reconcile` → `events` →
  `canonicalize` → `chronology` → `segment` for Extract — each stage one step, following ADR
  0014 §2's reasoning that a step boundary belongs where a real durability/retry need is, not at
  every internal call.
- Cost tracking reuses `src/edition/run-report.ts`'s existing `costForCalls` machinery per stage,
  since Extract in particular is the priciest pipeline stage measured so far (#173's ~$0.40–0.45
  scoring-only figure on a single fixture) and a user-submitted length is unbounded.

### 5. One combined job; the author reviews after segmentation, through the existing import preview

Generation/extraction and segmentation run as stages of the **same** Authoring run, not two
author-visible jobs with a manual continue between them. A Fabula-only, unsegmented package isn't
reviewable in any UI the author already has — the Manuscript editor and the linter both operate
on Scene Cards — so pausing mid-pipeline for a "continue?" click would ask a question with no
real decision behind it.

What the author sees:

- **While running**: stage-based progress text ("drafting the arc," "segmenting into scenes"),
  mirroring ADR 0014 §4's mechanism (status events over the same kind of resumable/reconnect-safe
  stream) but with a stage vocabulary instead of a scene count, since there is no scene count
  until the `segment` stage finishes.
- **On completion**: the resulting package lands in the same import-preview screen
  `new-story-view.tsx`'s `mode === 'import'` branch already renders for a pasted/uploaded file
  (title, scene count, entity count, lint error count) — never silently published, never
  auto-created as a Manuscript. That preview gains one field #172 already named: a
  scene-count-vs-event-count ratio, surfaced as a quality signal for segmentation's known
  over-segmentation risk (#146). Consistent with ADR 0017 §4's "warn never blocks" philosophy,
  this signal never blocks the import — the author can commit to a choppy result on purpose,
  the same way they can publish past a hand-authored warning today.
- **Cost guard**: the job's `POST` body carries the same `writer: 'live' | 'stand_in'` toggle the
  tellings route established (`app/api/stories/[storyId]/tellings/route.ts`), and the UI requires
  an explicit confirm action before starting — never auto-start on typing a premise or pasting
  prose, per #171's cost-risk note (a 10-minute rolling spend cap and full prepayment-credit
  depletion both already hit this project during routine measurement work).

## Consequences

- Amends [ADR 0017](0017-the-manuscript-and-publishing.md) §5 (a fourth/fifth *UI* entry point
  exists, but resolves through the existing Import persistence path, not a new one) and narrows
  §10 (the per-card model-proposed source stays unbuilt and unreopened; what's decided here is
  package-level, going through §6's escape hatch instead).
- `CONTEXT.md` and `GLOSSARY.md` gain **Authoring run**, in the Compilation section, defined
  against the existing Read-time run loop entry so the two "run" concepts don't collide.
- [#172](https://github.com/tschomay/axiom-weaver/issues/172) (Generate) and
  [#173](https://github.com/tschomay/axiom-weaver/issues/173) (Extract) are unblocked: the job
  shape, entry-point mechanics, segmentation sequencing, and review/quality-signal surface are
  all settled here, in that priority order. Both still need `StepRunner` promoted out of
  `src/edition/run-loop.ts` into its own module before either can import it without reaching into
  the read-time run loop's file.
- No change to the read-time run loop, the Manuscript/publish machinery, or any reader-facing
  surface. An Authoring run is strictly an author-time producer of the same `StoryPackage` shape
  Import already accepts.

## Amendment — as built (#172, #173)

Decision 4 sketched finer stages than either run ended up with. As built, a Generate run has two
stages, `arc` then `segment`, and an Extract run has two, `extract` then `segment`. Extraction's
passes (entities → reconcile → events → canonicalize → chronology → seed, numbered 1–5 with
canonicalize as 3b) run inside one
`extractStoryPackage` call and none of them is independently resumable today, so a step boundary
per pass would promise a retry granularity nothing backs — the reasoning decision 4 itself cites
from ADR 0014 §2. Which pass is running still reaches the author: the pipeline's own
`pass N/5 — …` progress lines are flushed to the manifest's `stage_text` as they arrive.

Extract (#173) also adds what decision 5's cost guard needed for an unbounded input: a hard word
bound (`PASTED_SOURCE_MAX_WORDS` in `src/extraction/limits.ts`, 30,000 — just above the longest
source ever measured) checked before any call is made, and a raw-text source
(`pastedSource` in `src/extraction/sources.ts`) in place of the manifest lookup the CLI uses.
Its POST also accepts one of the three known-good fixture sources by id, so a UI run can be
compared against `fixtures/extraction/runs/` before being trusted on novel text.
