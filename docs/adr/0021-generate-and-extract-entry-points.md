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

## Amendment (2026-09-29): a motivation gate on generated arcs, decision beats on the card

[#199](https://github.com/tschomay/axiom-weaver/issues/199). In all five stories of Story Review
Panel batch 2026-09-29, the character reviewer's top finding was a decisive turn made between
scenes or for no visible reason. In `03`, Hettie trips the scour straight after the only two events
that bear on it argue against it; the causal link was declared and the motive was not.

- **Generation runs a motivation gate after repair** (`motivationGate`, `src/arc/motivation.ts`):
  one call, reusing the judge's blind arc view (#192), asks about the final phase's events and any
  event whose summary or beats turn on a decision ("decides", "realizes", "confesses", "refuses"…),
  and for each unmotivated act returns a beat that stages the reason, built from the arc's own
  people and events. The beat is installed first among that event's beats. A failed call or an
  unparseable answer leaves the arc as it was. `GeneratedArc.motivation` reports what was checked
  and found; the call is recorded with stage `motivation`.
- **Segmentation never opens a card on a decision** (`stageDecisionTriggers`): if a card's first
  beat is a decision, the most recent cause its events name is staged before it. The scene-card
  pass is asked for the same ordering. With no stated cause nothing is invented.
- **The writer is told to dramatise a decision on the page** whenever a card's beat is one.

## Amendment (2026-09-29): every stake is answered

[#200](https://github.com/tschomay/axiom-weaver/issues/200). All five stories of panel batch
2026-09-29 raised a stake with weight and dropped it — the critic who never tastes the dish, the
five thousand people downstream, the deed box — and where the arc left a gap the writer filled it
with an offstage invention (`04`'s envelope swap, in no event and on no card).

- **The generated arc gains `stakes: {stake, introduced_by, resolved_by}[]`** (the Fabula block,
  `StakeSchema`, read back by `readFabulaArc`). The prompt asks for every deadline, threat, debt or
  cost the story raises and the later event that resolves it or has a character explicitly let it
  go. This makes the check mechanical rather than a judge call.
- **`stake_unresolved`** (a Fabula-layer error, `stakeProblems`): a stake with no answering event,
  an unknown one, or one that does not come after the stake. An error, so it is a repair target in
  every plot shape; the repair vocabulary gains `resolve_stake`, which points the stake at a later
  event and stages the answer there as a beat.
- **The writer contract** says: if the card does not provide the mechanism for an outcome,
  dramatise it in the scene; never report an offstage swap, visit, discovery or conversation.
- Not done here: #200's third item, a continuity-pass check for a digest that introduces an event
  or object no card has. Detecting it from digests needs a comparison this change has no
  evidence for yet; it is tracked as a follow-up.

## Amendment (2026-09-29, later): a sharper motivation gate, contradicted reveals, derived stakes

[#218](https://github.com/tschomay/axiom-weaver/issues/218). In the #204 re-run the gate installed one motive beat per
batch while character stayed at 3.0 and 2.75: arcs *state* a reason ("undone", "broken"), and the judge accepted a
stated reason. Three random stories' climaxes contradicted a fact the story had just revealed (Toll drains a lake it
has just established holds up a cavern; Terms of Sale clears a heroine the reader watched lie). And every declared
stake had a `resolved_by`, while the stakes the stories actually dropped were ones the arc never declared, or were
"resolved" by an event that only asserts the outcome.

The gate stays one call, asking about the same events, and now asks three things instead of one:

1. **Staged, not stated.** For each decisive act: which *earlier event* changes this character's mind, and is it on
   the page? A reason that is only a summary word, or an antagonist's confession or collapse in the final phase with
   no preceding pressure event, is flagged (`kind`: `stated_not_staged`, `no_reason`, `sudden_collapse`).
2. **Contradicted reveals.** Does the act contradict or ignore a fact revealed earlier — a danger established, a lie
   the reader saw? Flagged as `contradicts_reveal`; its `motive_beat` must confront the revealed fact on the page.
3. **Derived stakes.** Candidate stakes are derived mechanically (`deriveCandidateStakes`) — every revealed fact
   whose statement names a number, a deadline, a debt or a threat, and every seed object two or more event summaries
   name — and listed for the judge beside the declared ones. For each that no later event resolves *on the page*, the
   answer names the event that should, with a beat; the beat is added there and the stake joins `stakes` with that
   `resolved_by`, so `stake_unresolved` holds it from then on.

A card-level warning joins them: **`decision_party_absent`** — a beat that reconciles, forgives, confesses to or
gives up for a named character who is not in `characters_present`. The sisters' reconciliation in the after batch's
Borrowed Boat happened with Ruth off the card.
