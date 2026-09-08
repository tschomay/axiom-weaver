# ADR 0013: Recitation control on the famous-prose fixture

## Status

Accepted — settled in [Regurgitation control on the famous-prose fixture](https://github.com/tschomay/axiom-weaver/issues/17),
worked as a prototype on the throwaway branch `prototype/recitation-control`
([prototype file](https://github.com/tschomay/axiom-weaver/blob/prototype/recitation-control/prototypes/recitation-control.prototype.html)).

## Context

The two fixtures ([issue #4](https://github.com/tschomay/axiom-weaver/issues/4)) were
deliberately chosen so one — *A Christmas Carol* — is a story the writer model has
almost certainly memorised close to verbatim, and the other — this specific 1889 Lang
translation of Cinderella — is not. The contrast only works as a test if the engine
*performs* the memorised story instead of *reciting* it back. [ADR
0012](0012-writer-prompt-contract.md) item 6 already gave this ticket a starting point:
a `RECITATION` finish-reason retry hook and a reserved `recitation_flagged` diagnostic,
inherited rather than re-derived here.

This session had no Gemini API credentials and no network path to Google's endpoints, so
no real model call was made and no real baseline number was produced. What follows is an
architectural finding (independent of any specific model run) plus one hand-written
worked example, in the same spirit as [issue #16](https://github.com/tschomay/axiom-weaver/issues/16)'s
hand-written prototype scene.

## Decision

1. **The Scene Card itself already quotes Dickens.** `scene_01_counting_house` in
   `fixtures/a-christmas-carol/package.json` — the single highest recitation-risk scene
   in either fixture — has three of its five `required_beats` embedding the book's own
   wording verbatim or near-verbatim: *"Bah! Humbug!"*, *"decrease the surplus
   population"*, *"a poor excuse for picking a man's pocket every twenty-fifth of
   December."* This is an authoring choice made in [issue #18](https://github.com/tschomay/axiom-weaver/issues/18),
   not a defect. It reframes the whole ticket: the question is never "did any Dickens
   wording appear," it's "did wording appear that the Scene Card never asked for."

2. **No client-side text-similarity detector is built.** The obvious instinct — diff
   generated prose against the source novel — is architecturally unbuildable here: the
   Story Package schema (ADR 0001) and the read-time assembler (ADR 0008, ADR 0012) never
   carry canonical source prose. The engine's data model is Fabula/Syuzhet (Scene Cards,
   World Model) plus its own digests; nothing in that pipeline holds "here is Dickens'
   actual paragraph, diff against it." Adding such a field would mean embedding a full
   copy of the source novel into every famous-prose Story Package for the sole purpose of
   self-plagiarism-checking — out of this ticket's mandate, and only ever relevant to a
   minority of Story Packages. Diffing against the Scene Card's own text instead would
   detect the wrong thing: per finding 1, that text already contains the phrases most
   likely to trip a naive detector, by design, so such a check would just confirm the
   writer did its job, every scene, every fixture — noise, not a recitation signal.

3. **Detection is `finishReason: RECITATION`, and only that.** It is the one detector
   that actually exists: Google's own training-corpus classifier, confirmed in the
   discovery document by [issue #5](https://github.com/tschomay/axiom-weaver/issues/5)'s
   research (`docs/research/gemini-capabilities.md` §1), running a comparison the
   compiler has no way to run locally. No new detection mechanism is added.

4. **Authored quotation vs. unbidden recall is not distinguished, and does not need to
   be.** A phrase quoted in `required_beats`/dialogue is the writer satisfying its brief
   — identical in kind to any other author-mandated line, not recall in the sense this
   ticket worries about. Detection and mitigation are scoped to reproduction *beyond*
   what the Scene Card requested: connective narration, description, and staging the
   model originates on its own that happens to closely track the source's actual prose
   rather than the Voice Card's instructed style.

5. **Mitigation reuses ADR 0012 item 6 unchanged.** One retry with a paraphrase
   instruction on `RECITATION`; a second occurrence falls through to the existing
   `scene_generation_failed` path (whatever prose exists is committed, digest built
   conservatively, logged at `error`, run continues), tagged with the diagnostic name
   ADR 0012 item 7 already reserved for this (`recitation_flagged`). No new failure
   category, no new digest field, no new schema surface. Prompt-level defenses this
   ticket declines to add preemptively (deliberately detuning the Voice Card away from
   Dickens' own register, paraphrase-forcing beyond the existing retry instruction) are
   left for later, and only worth adding if the baseline (item 6) shows a persistent
   problem — a defense that costs prose quality isn't worth having against a problem
   that may not exist.

6. **Baseline is deferred to execution, not decided here.** This is a planning session
   with no model access; "run it and measure" cannot happen inside a wayfinder ticket.
   The first real read-time run of the *A Christmas Carol* fixture, whenever [the
   read-time run loop](https://github.com/tschomay/axiom-weaver/issues/19) is actually
   built and executed, must log `finishReason` per scene and specifically compare
   `RECITATION` frequency against the Cinderella fixture (the control, expected near
   zero). If that run shows `RECITATION` firing persistently even after the one-retry
   mitigation, that is new information for a future ticket to act on — this one closes
   on the design, not on a number it cannot produce.

7. **Public-domain reality check.** Both fixtures are legally reproducible; the concern
   is representational, not legal. The line: an *engine-initiated*, multi-sentence
   verbatim reproduction the Scene Card never asked for would make the POC dishonest
   about its own generative capability. An author-instructed short quotation, or the
   model's compliant rendering of one, is not that, and the engine is not obligated to
   guarantee zero verbatim overlap with public-domain source material the author chose to
   quote.

## What the prototype showed

A hand-written ~330-word performance of `scene_01_counting_house`, in the fixture's
Dickensian-comic-gothic Voice Card register, satisfying all five `required_beats` and the
scene's sole invariant. The three author-mandated quotations sit inside otherwise-original
sentences without reading as seams to a human eye — the qualitative version of this
ticket's requested diagnosis: whole-passage reproduction did not occur; isolated-line
reproduction occurred exactly where the Scene Card asked for it. This is one hand-written
sample and is not a statistical claim about `gemini-3.7-flash`'s actual behavior — see
Decision item 6.

## Consequences

- No new schema field, digest field, or runtime mechanism. `recitation_flagged`
  (ADR 0012 item 7) already covers this ticket's logging need.
- `CONTEXT.md`'s seam-failure rubric (ADR 0002) is not extended with a ninth row.
  Recitation is a source-fidelity concern, not a Fabula/Syuzhet-continuity one — a
  different axis from every failure mode the rubric tracks — and it already has its own
  resolved detection/mitigation path here, so it doesn't need a rubric row to be covered.
- Leaves an explicit, named gap for whoever builds [the read-time run loop](https://github.com/tschomay/axiom-weaver/issues/19):
  log `finishReason` per scene from the very first real run, and treat the *A Christmas
  Carol* fixture's `RECITATION` rate (vs. Cinderella's) as this ticket's deferred
  baseline question, not a rediscovery.
- Does not unblock any other open ticket — #17 was a leaf on the map.
