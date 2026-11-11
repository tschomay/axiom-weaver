# ADR 0023: Generated arcs stay chronological for now; when that changes, the telling order is a separate pass over a chronological Fabula

## Status

Proposed. Written for [#150](https://github.com/tschomay/axiom-weaver/issues/150) as step 2 of
[#230](https://github.com/tschomay/axiom-weaver/issues/230), by an agent working without the owner
in the loop. It changes no code and no schema. Accept it, amend it or reject it before anything is
built on it.

## Context

Extraction recovers two orders from a source: when each event happens, and when the source tells
it (`narrated_index`, an extraction-only extra under [ADR 0019](0019-fabula-only-packages.md)).
Segmenting the *Carol* in told order rather than chronological order took it from 63 scenes to 47
and from one premature reveal to none.

Generation authors one order. Its event list is chronological, its own gate requires every plant
to precede its payoff in that list, and `tellingOrder()` reported `basis: fabula_sequence`,
`displaced: 0` on every generated arc it has ever been given
(`docs/research/generated-arc-segmentation.md` §6). #150 asks three questions: should generation
author a telling order, what happens to the plant-precedes-payoff rule if it does, and is this
worth doing now.

### The gap is narrower than #150 states it

#150 says a generated arc "cannot currently express a *Carol*-style withholding (show the reader
something out of chronological order, or delay a reveal past where it chronologically belongs)".
Those are two different things, and only one of them is out of reach.

**Delaying a reveal is reachable, and generated arcs do it constantly.** A generated event carries
`reveals`, `conceals` and `recounts`; [ADR 0022](0022-fact-statements-and-the-hidden-account.md)
added the hidden account; a `plant: null` payoff collects something that was true before the story
opened. Across the 24 generated packages committed under `prototypes/`:

| | packages | Scene Cards | cards with `must_stay_hidden` | `pays_off` edges | of which seed-grounded |
| --- | --- | --- | --- | --- | --- |
| `segmentation/generated` | 9 | 131 | 83 | 97 | 31 |
| `story-review/2026-09-29` | 5 | 54 | 9 | 50 | 10 |
| `story-review/2026-09-29-after` | 5 | 53 | 30 | 44 | 8 |
| `story-review/2026-09-29-random` | 5 | 47 | 27 | 48 | 11 |
| all | 24 | 285 | 149 | 239 | 60 |

Half the cards withhold something, and a quarter of all payoffs collect a fact from before the
first scene. The reader of a generated story already learns things in a different order from the
one they happened in. What no generated story does is *stage* a scene out of order.

**Staging a scene out of story-time order is the part that is unreachable.** Measured on the
fixtures, as scene pairs whose told order and chronological order disagree
(`fixtures/extraction/chronology.json` against each package's scene `order`):

| fixture | scenes | inverted scene pairs | what the displaced scenes are |
| --- | --- | --- | --- |
| Cinderella | 14 | 0 of 91 | none |
| *The Machine Stops* | 16 | 3 of 120 | Kuno's climb, which he recounts to Vashti in one sitting |
| *A Christmas Carol* | 20 | 33 of 190 | the Spirits' visions of the past and of the future |

Every inversion in the three fixtures has a character inside the story who is telling it or being
shown it. Kuno narrates his climb to his mother. Scrooge stands in each vision. Extraction's own
prompt already describes this shape: "A scene in which a character is SHOWN a memory contains
both: the showing is 'present', the remembered happening is 'past'."

That matters because a showing or a recounting is an event in the story's running present. A
generator can author "the Spirit shows Scrooge the schoolroom" in a chronological list today. What
it cannot do is cut to the schoolroom with nobody watching: a flashback with no viewer, a
flash-forward the characters never see, or an opening in the middle of things. The fixtures
contain no example of that.

### What staging a scene out of order would cost

Three mechanisms currently rely on told order and story order being the same for generated input.

1. **World Model state.** `src/segmentation/state.ts` computes each scene's `entry_state` from a
   projection "advanced scene by scene", the linter's `stateChaining` compares consecutive scenes,
   and the state log ([ADR 0016](0016-author-surfaces-and-the-state-log.md)) is the seed replayed forward
   through entries in the order scenes were compiled. A scene set ten years earlier and
   placed after the present would be staged against the present's world. The *Carol* avoids this
   only because Scrooge, and so the present, is in every vision. Fixing it means deciding how state
   is read as of a story time, which is an ADR of its own against
   [ADR 0005](0005-state-update-authority.md) and [ADR 0016](0016-author-surfaces-and-the-state-log.md).
2. **The plant gate.** Generation checks plant-before-payoff in the event list. The
   [ADR 0004](0004-plant-obligation-walk.md) walk checks it in scene order. They agree today
   because the orders agree.
3. **The rubric.** Causal follow-through gained `story_time_jump` in #147 and still fails the
   *Carol* for a reason that is being worked out in #159. Segmentation's plant score is 1 of 31
   for reasons `docs/research/plant-pass-diagnosis.md` puts mostly outside the plant pass. A new
   structure would arrive before the instruments that would have to score it can be trusted.

## Decision

### 1. Not now

Generation keeps authoring a chronological Fabula and no telling order. `narrated_index` stays an
extraction-only extra. This is #150's third question answered first, because the answer to it
makes the other two a direction and not a build.

The evidence is the two tables above. The capability that is missing is narrower than the one
#150 describes; no fixture uses it; the capability next to it, withholding, is in half of all
generated Scene Cards already; and the price of the missing part is a World Model decision that
nothing else is asking for.

### 2. When it is taken up, the telling order is its own pass

To #150's first question: neither of the two options as posed. The generator should not author a
telling order while it authors events, and segmentation should not invent one.

- **The generated Fabula stays chronological and stays the authority** for `caused_by`, for
  `state_changes`, and for the generator's existing gates, all of which keep working unchanged.
- **An arrangement pass runs after generation and before segmentation.** It reads the whole arc
  and may write `narrated_index` onto events, the same key extraction writes. Segmentation already
  consumes that key and needs no change, which is the measured *Carol* path.
- **The pass moves whole blocks, and says why.** A displaced block is recorded with the reason it
  was moved, so an arrangement can be argued with the way a beat classification can.

This keeps the three layers in `CONTEXT.md` three: Fabula first, arrangement second, prose last.
It also means the first version needs no new field anywhere.

### 3. Plant precedes payoff in told order; cause precedes effect in story order

To #150's second question: the rule does not change, it splits, because it was always two rules
that happened to coincide.

- `caused_by` is a claim about the story's world and stays chronological.
- Plant-before-payoff is a claim about the reader and belongs to told order. ADR 0004's walk
  already checks it there, on scenes, so ADR 0004 is not amended.
- The arrangement pass may not produce an order that puts a payoff before its plant. That is a
  mechanical check on its output, and a block whose move would invert an edge is not moved.

One limit follows and is accepted: an arrangement can only reorder pairs the chronological arc
already has. It cannot create the pair where the present plants a puzzle and a flashback answers
it. That pair is expressible today as `conceals` then `reveals`, which is how generated arcs
already do it.

### 4. What reopens this

Any one of:

- A story the owner wants that needs a scene staged out of order with nobody in the story watching.
- A second fixture built on non-chronological telling. There is one, and #159 has the same
  complaint about montage.
- A decision, made for its own reasons, on reading World Model state as of a story time.

## Consequences

- #150 can close against this ADR once it is accepted. Nothing is built.
- "Every generated package is linear by construction" stays true and is now a recorded choice.
- If a framed non-chronological story is wanted sooner (a character recounting, a character being
  shown), that is a generation-prompt question, not a schema one, and it would need its own
  measured before and after like any other prompt change.
- The cost named in Context item 1 is the real blocker. Anyone picking this up should start there
  and not with the generator.
