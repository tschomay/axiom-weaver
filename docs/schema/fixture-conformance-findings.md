# Fixture conformance findings

What loading both fixture Story Packages through the schema, the World Model, and the
state-update authority validator end to end actually turned up. Produced by
[build 1/4](https://github.com/tschomay/axiom-weaver/issues/39); the checks live in
`tests/fixtures-end-to-end.test.ts` and `src/fixtures/load.ts`.

`fixtures/authoring-notes.md` closes on the finding that "schema-conformance checking absolutely
should be tooling, not author discipline". This file is what that tooling reported the first time
it ran.

## Both fixtures load clean

`fixtures/cinderella` (14 Scene Cards, 21 entities) and `fixtures/a-christmas-carol` (20 Scene
Cards, 40 entities) both parse against `docs/schema/story-package.md` with **no schema mismatch**
and **no unresolved reference** — every `pov`, `location_id`, `characters_present` entry,
`entry_state`/`exit_state` entity and column, `_new_relationships`/`_new_character_knowledge`
endpoint, and `pays_off[].plant` resolves, and every plant is earlier in the Syuzhet than the
scene that pays it off.

Every state update the cards' own `exit_state` blocks declare is accepted by the validator: no
`exit_state_contradiction`, no `unauthorized_entity_update`, no `unentailed_reversion` in either
package.

## Three cross-scene continuity gaps

Compiling every card in order — running ADR 0005 §1's entry check against the World Model as the
previous cards left it — surfaces three `entry_state_mismatch` errors. All three are the same
shape: a card asserts a character is somewhere no earlier card ever moved them to.

| Fixture | Scene | Asserted on entry | World Model holds |
| --- | --- | --- | --- |
| cinderella | `scene_10_second_ball_the_flight` | `char_cinderella.location_id = loc_ball_hall` | `loc_chimney_corner` |
| a-christmas-carol | `scene_18_the_waking` | `char_scrooge.location_id = loc_churchyard` | `loc_cratchit_flat` |
| a-christmas-carol | `scene_20_the_office_next_morning` | `char_bob_cratchit.location_id = loc_counting_house` | `loc_cratchit_flat` |

These are exactly what ADR 0005 §1's check exists to catch, and they are findings about the
fixtures, not validator faults. They split into two causes:

1. **A missing presence rule (the Scrooge case).** Scrooge is `characters_present` at
   `scene_17_the_name_on_the_stone`, whose `location_id` is `loc_churchyard`, but no card commits
   his move there — his last committed location is scene 15's `loc_cratchit_flat`. A rule that a
   present character ends a scene at that scene's location unless `exit_state` says otherwise
   would close this without touching the fixture. That is a **run-loop** decision
   ([issue #19](https://github.com/tschomay/axiom-weaver/issues/19)), not a schema one: it is the
   engine deciding to emit a state update, and this ticket's validator only judges the updates it
   is handed. Flagged there rather than assumed here.

2. **An uncarded transition (the other two).** Nothing in Cinderella carries her from the
   chimney-corner to the second ball — the departure is compressed into `scene_10`'s own beats
   while its `entry_state` describes the world *after* the arrival. Likewise nothing puts Bob back
   in the counting-house between Christmas at his flat and `scene_20`. A presence rule does not fix
   either; only the author can, by carding the transition or by relaxing the `entry_state`
   assertion.

Both are pinned in `tests/fixtures-end-to-end.test.ts` as `KNOWN_ENTRY_STATE_GAPS`, so a fixture
fix or a lost check shows up as a failing test either way.

## Two conventions this ticket made concrete

`docs/schema/story-package.md` types `entry_state`/`exit_state` as opaque JSON, and
`fixtures/authoring-notes.md` §2 asks that the runtime not invent a second convention alongside
the one the fixtures adopted. It doesn't:

- **`{ <entity_id>: { <column>: <value> } }` plus the reserved `_new_relationships` /
  `_new_character_knowledge` keys** is now the parsed shape (`src/schema/story-package.ts`), and
  `stateToUpdates` normalizes it into the same per-entity, per-column list ADR 0005's
  consequences require of the writer's `state_updates` (`src/schema/state-update.ts`).
- **A row's existence is written as the reserved pseudo-column `_row`** — tier P on a
  `relationship`, tier E on a `character_knowledge` row, per the schema doc's "the *row's
  existence* is the epistemic fact". That keeps inserts and column changes in one shape the
  commit log (ADR 0016 §2) can record without a second entry type.

A card that declares a row under `_new_relationships` / `_new_character_knowledge` thereby brings
that row's endpoints into the scene's footprint, even when they are not `characters_present`. Both
fixtures need this and both are right to: Cinderella's fitting records that the *Prince* learns who
she is without the Prince in the room, and Scrooge becomes a merciful creditor to Caroline, who is
not present either. The author naming the row *is* the narrative reason ADR 0005 §2 asks for.
