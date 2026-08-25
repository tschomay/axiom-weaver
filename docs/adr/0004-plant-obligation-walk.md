# ADR 0004: The plant-and-payoff obligation walk

## Status

Accepted — settled in [The plant-and-payoff obligation walk](https://github.com/tschomay/axiom-weaver/issues/8),
prototyped on the throwaway branch `prototype/plant-obligation-walk`
([prototype file](https://github.com/tschomay/axiom-weaver/blob/prototype/plant-obligation-walk/prototypes/plant-obligation-walk.prototype.html)).

## Context

[Schemas for the Story Package and World Model](https://github.com/tschomay/axiom-weaver/issues/2)
gave Scene Card a `pays_off: TEXT[] FK → scene_card.id` field and explicitly deferred its
mechanics — the backward walk that turns those links into per-scene plant obligations, and
what the writer is actually told — to this ticket. "Dropped setup" is a digest-detectable
seam-failure mode (ADR 0002) whose mechanism owner is this walk, so it has to produce
something the plant-opened check in the Scene Digest (ADR 0003) can verify against.

The rejected alternative, named in the ticket, is showing the writer raw look-ahead (the next
N Scene Cards verbatim) — that leaks the future into the prose and makes the engine foreshadow
too loudly. The walk exists so the writer sees an obligation, never the payoff.

## Decision

1. **Declaration shape supersedes the bare id array.** `pays_off` entries are
   `{ fact_ref: TEXT, plant: TEXT FK → scene_card.id | null }`, not bare scene ids. A bare id
   can't carry *what* is being paid off, can't be validated against the plant scene's own
   declarations, and can't drive a specific instruction. `fact_ref` reuses the told-ledger's
   existing identity scheme (ADR 0003) rather than inventing a second one — the same slug a
   Scene Card's `reader_must_learn` already uses. `plant: null` marks a payoff grounded in the
   World Model seed rather than any scene (e.g. Scrooge is already forging his own chain
   before the story opens).

2. **The compiler never invents where a plant lands.** A plant scene must list the `fact_ref`
   in its own `reader_must_learn` — the payoff scene names *which* earlier scene carries the
   plant, but that scene must independently declare the fact, or the walk rejects the pair
   (`plant_not_declared`). This is the direct consequence of "the engine never invents plot"
   (map Notes): if the author didn't declare a plant, the compiler doesn't guess one.

3. **The walk is a reverse index, not a search.** For every scene's `pays_off` entries, look
   up the named plant scene and append an obligation to it. This gives fan-in for free in both
   directions the ticket asked about:
   - **Multiple payoffs of one plant** — the same plant scene id appears in several different
     later scenes' `pays_off`; each produces its own obligation entry on that plant scene.
   - **Multi-scene reinforcement** — one payoff names the *same* `fact_ref` against *several*
     plant scenes (e.g. "surplus population" plants at both the counting-house and Marley's
     ghost before the Ghost of Christmas Present pays it off); each plant scene picks up its
     own obligation for that fact, independently verified.
   - **Seed-grounded payoffs** — `plant: null` checked against the Story Package's seed-known
     facts (`character_knowledge` rows with `learned_at_scene: null`) rather than against any
     scene; no obligation is created because there is nothing to plant.

4. **Validation runs before generation, not after.** Two author-time errors, both hard
   failures (never silently patched):
   - `plant_after_payoff` — the named plant scene's `order` is not strictly before the payoff
     scene's. Statically checkable from Scene Card order alone.
   - `plant_not_declared` — the plant scene exists and precedes the payoff, but never lists
     the fact in its own `reader_must_learn` (see point 2).
   - `unfounded_seed_payoff` — a `plant: null` payoff whose fact isn't actually seed-known.

   All three were exercised in the prototype and rejected correctly without generating a
   single token.

5. **The writer instruction is templated, not authored per-obligation.** Deriving it from the
   `fact_ref` alone — "make the reader register `<deslugged fact_ref>` without dwelling on
   it, a detail that passes by, not a flagged clue" — deliberately never names the payoff
   scene, which is what keeps it vague enough not to telegraph. It stays specific enough to
   act on only as long as `fact_ref` slugs are written descriptively (`loose_stair_rail`, not
   `fact_17`); this is a naming-discipline dependency on the author, not a schema gap. If slug
   quality proves insufficient in practice, a `facts` glossary carrying a human-readable label
   per `fact_ref` is the natural extension — flagged as fog, not built now, since neither
   fixture has forced the question.

6. **Post-generation verification logs, it doesn't block.** An obligated scene's digest
   `plants_opened` field (ADR 0003) is checked against what it owed. Read-time (unattended,
   per the map's Notes — "nothing may block on an author who is not there"): a miss gets one
   bounded retry with the same instruction restated, then — if still missing — logs to the run
   report as a diagnostic (per `CONTEXT.md`'s Diagnostics section) and the compile continues;
   an unresolved miss is exactly the "dropped setup" rubric mode, consciously surfaced rather
   than hidden. Author-time (stepwise, human present): the miss surfaces immediately as a
   compile warning, no auto-retry, since the author can just fix the card.

## Consequences

- `docs/schema/story-package.md`'s Scene Card `pays_off` field definition is updated to this
  shape; the schema's "What this deliberately does not settle" note pointing at issue #8 is
  resolved.
- The writer's structured output (issue #16, the writer prompt contract) must accept a
  per-scene obligation list (fact_ref + instruction text) as an input alongside the existing
  Scene Card fields, and must report which obligated `fact_ref`s it actually planted via
  `plants_opened` — already true of the Scene Digest shape (ADR 0003), so no new digest field
  is needed.
- Authors gain an implicit naming convention: `fact_ref` slugs used in a `pays_off` entry
  should read as a short plain-language label, since the walk turns them directly into the
  writer's instruction.
