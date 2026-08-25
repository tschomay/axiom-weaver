# Schema: Story Package and World Model

Resolves [Schemas for the Story Package and World Model](https://github.com/tschomay/axiom-weaver/issues/2),
part of [Map: The Narrative Machine](https://github.com/tschomay/axiom-weaver/issues/1).

Terms are from [`CONTEXT.md`](../../CONTEXT.md). Examples throughout use the **Cinderella**
(Lang, 1889) and **A Christmas Carol** (1843) fixtures — see
[`docs/research/fixture-stories.md`](../research/fixture-stories.md).

This is the schema **World Model** tables sit on, plus the **Scene Card** and **Story Package
envelope** shapes. It does not cover the Scene Digest, told-ledger, or Voice Card field-level
shape — those belong to [The Scene Digest and the told-ledger](https://github.com/tschomay/axiom-weaver/issues/7)
and [The Voice Card and the style presets](https://github.com/tschomay/axiom-weaver/issues/11).
It does not cover *how* a tier is enforced (validation, unattended resolution, diagnostics) —
that's [State-update authority: what the engine may commit](https://github.com/tschomay/axiom-weaver/issues/9),
which this schema unblocks.

## Governing principles

Four rules settle every column decision below; apply them rather than re-deriving column choices
from scratch.

1. **Identity is a stable slug id, never a name.** `name` is an ordinary mutable column.
   Renaming a character is a one-column update — nothing else in the schema moves, because
   every cross-reference (Scene Cards, relationships, digests) points at the id.
2. **Tier is a per-column, schema-level attribute — never per-row.** A property's tier answers
   "what kind of fact is this", not "is this instance special". `char.location_id` is always
   physical; `char.goal` is always volitional. Bag columns carry **no tier** — they are
   author-only and never engine-writable, until/unless a value is promoted to a core column.
3. **Single-valued facts are columns; growing, multi-valued facts are edges or join tables.**
   A character has exactly one current location → column. A character accumulates many known
   facts over a story → join table (`character_knowledge`). A character can hold many objects →
   relationship edges (`possesses`), not a list-column.
4. **Bag values are flat scalars only** (string, number, boolean, or a short string array for
   tags). No nested objects. The moment a bag value needs structure, that's the signal it should
   graduate to a core column instead — keeps "as if SQL" honest and keeps prompt-assembly
   serialization trivial.

Tier legend: **P** = physical (engine writes freely, auto-committed), **E** = epistemic (engine
writes freely, auto-committed), **V** = volitional/relational (engine may only *propose* — see
issue #9), **—** = untiered (identity or author-only, never engine-written).

---

## World Model tables

### `character`

| Column | Type | Tier | Notes |
| --- | --- | --- | --- |
| `id` | TEXT PK | — | slug, e.g. `char_cinderella`, `char_scrooge` |
| `story_id` | TEXT | — | part of the composite key in a real multi-tenant table |
| `name` | TEXT NOT NULL | P | display name; renaming is a plain update |
| `location_id` | TEXT FK → `location.id`, nullable | P | queried on every scene for presence validation |
| `status` | TEXT, nullable | P | free text: `alive`, `dead`, `injured`, … |
| `goal` | TEXT, nullable | V | self-contained goal not aimed at another entity; author's territory, engine may only propose |
| `bag` | JSON | — | author-invented attributes, flat scalars only |

Example (Cinderella, after scene 5): `{id: "char_cinderella", name: "Cinderella", location_id: "loc_ball_hall", status: "alive", goal: "attend the ball", bag: {epithet: "Cinderwench"}}`.

Feelings *about* another character (the sisters' resentment, the Prince's growing interest) are
**not** a column here — they're `sentiment` on a `relationship` row (below), because they're
inherently about a target, not a standalone fact about this character.

### `location`

| Column | Type | Tier | Notes |
| --- | --- | --- | --- |
| `id` | TEXT PK | — | slug, e.g. `loc_chimney_corner`, `loc_cratchit_flat` |
| `story_id` | TEXT | — | |
| `name` | TEXT NOT NULL | P | |
| `bag` | JSON | — | description, atmosphere, etc. |

Deliberately thin. Neither fixture needs a spatial graph (adjacency, travel time) — a Scene Card
declares its `location_id` directly, and nothing in the compiler navigates between locations.
Add `accessible: BOOLEAN` (tier P) only if a future fixture needs a location that becomes
unreachable mid-story (collapsed, locked); neither Cinderella nor *A Christmas Carol* does.

### `object`

| Column | Type | Tier | Notes |
| --- | --- | --- | --- |
| `id` | TEXT PK | — | slug, e.g. `obj_glass_slipper`, `obj_marley_chain` |
| `story_id` | TEXT | — | |
| `name` | TEXT NOT NULL | P | |
| `location_id` | TEXT FK → `location.id`, nullable | P | where the object sits when **not** held by anyone |
| `status` | TEXT, nullable | P | `intact`, `broken`, `lost`, … |
| `bag` | JSON | — | |

`location_id` and a `possesses` relationship edge are two distinct physical facts, not a
redundant pair: `location_id` is where the object sits in the world; `possesses` is who is
currently holding it. When an object is held, `location_id` is `NULL` (its position is
implicitly wherever its holder is) — e.g. the second glass slipper has `location_id: NULL` and a
`possesses` edge from `char_cinderella` while it's in her pocket (scene 11), then `location_id`
is set once it's set down and no longer held.

### `relationship`

Directed edges between any two entities (character, location, or object).

| Column | Type | Tier | Notes |
| --- | --- | --- | --- |
| `id` | TEXT PK | — | slug or sequential, e.g. `rel_001` |
| `story_id` | TEXT | — | |
| `from_id` | TEXT FK → any entity table | — | |
| `to_id` | TEXT FK → any entity table | — | |
| `kind` | TEXT NOT NULL | P | structural fact: `possesses`, `stepmother_of`, `employer_of`, `sibling_of`, … |
| `sentiment` | TEXT, nullable | V | feeling `from_id` holds toward `to_id`: `resents`, `loves`, `fears`, … engine may only propose |
| `bag` | JSON | — | |

Directed because most story relationships aren't symmetric (`stepmother_of` ≠ `stepdaughter_of`).
A symmetric relation (`sibling_of`) is either two rows or a `kind` the retrieval layer treats as
bidirectional by convention — not a schema-level distinction.

Example chain for the possession plant/payoff: `{from: char_cinderella, to: obj_glass_slipper_2, kind: possesses}` created at scene 11, read back at scene 13 to validate the payoff.

### `character_knowledge`

Epistemic state: which characters know which in-world facts. Split out from `character` because
it's a growing, multi-valued fact per Principle 3 — one row per (character, fact) pair, not a
column that would have to hold an open-ended list.

| Column | Type | Tier | Notes |
| --- | --- | --- | --- |
| `id` | TEXT PK | — | |
| `story_id` | TEXT | — | |
| `character_id` | TEXT FK → `character.id` | — | |
| `fact_ref` | TEXT NOT NULL | — | free-text/slug fact identifier; the real fact-identity scheme belongs to issue #7 (told-ledger) — this table just needs a stable slot to reference into it |
| `learned_at_scene` | TEXT FK → `scene_card.id`, nullable | — | `NULL` if known from the World Model seed (i.e. true from the story's start) |
| `bag` | JSON | — | |

The *row's existence* is the epistemic fact — that's what's tiered **E**, engine-writable,
auto-committed. Example: `{character_id: char_prince, fact_ref: "cinderella_is_the_ball_girl", learned_at_scene: "scene_13_the_fitting"}`.

This is **in-world** knowledge (does the Prince know?), distinct from the **told-ledger**'s
reader knowledge (does the *reader* know?) — the two-memories split from `CONTEXT.md`. Both can
diverge from each other and from the World Model's raw facts; that divergence is the mechanism,
not a bug to reconcile.

---

## Scene Card

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | TEXT PK | yes | slug, e.g. `scene_04_godmother` |
| `order` | INTEGER | yes | position in the Syuzhet |
| `pov` | TEXT FK → `character.id` | yes | |
| `location_id` | TEXT FK → `location.id` | yes | |
| `characters_present` | TEXT[] FK → `character.id` | yes | |
| `dramatic_function` | TEXT | yes | why this scene exists in the arc |
| `entry_state` | JSON | yes | asserted world state on entry; checked by the validator (issue #9) |
| `exit_state` | JSON | yes | required world state on exit; the invariant the engine must reach |
| `required_beats` | TEXT[] | no, default `[]` | the variance-contract dial |
| `reader_must_learn` | TEXT[] | no, default `[]` | fact-refs, aligned with `character_knowledge.fact_ref` / the told-ledger scheme |
| `must_stay_hidden` | TEXT[] | no, default `[]` | fact-refs that must not surface this scene |
| `tone` | TEXT | no | |
| `length_budget` | INTEGER | no | target word count |
| `invariants` | TEXT[] | no, default `[]` | constraints beyond entry/exit that must hold throughout |
| `pays_off` | TEXT[] FK → `scene_card.id` | no, default `[]` | earlier scenes this one resolves; drives the backward plant-obligation walk (issue #8) |

A thin, transitional scene can legitimately carry only the eight required fields — optional
fields default to empty/null rather than forcing every scene to declare tone, beats, and
invariants it doesn't have.

---

## Story Package envelope

```json
{
  "schema_version": "1.0",
  "package_version": 1,
  "story_id": "cinderella",
  "world_model_seed": {
    "characters": [ { "id": "char_cinderella", "name": "Cinderella", "location_id": "loc_chimney_corner", "status": "alive", "bag": {} }, "..." ],
    "locations": [ { "id": "loc_chimney_corner", "name": "the chimney-corner", "bag": {} }, "..." ],
    "objects": [ { "id": "obj_glass_slipper", "name": "a glass slipper", "location_id": null, "status": "intact", "bag": {} }, "..." ],
    "relationships": [ { "id": "rel_001", "from_id": "char_stepmother", "to_id": "char_cinderella", "kind": "stepmother_of", "bag": {} }, "..." ]
  },
  "scene_cards": [ { "id": "scene_01_remarriage", "order": 1, "pov": "char_cinderella", "...": "..." } ],
  "voice_card": { "...": "opaque here — field-level shape owned by issue #11" },
  "metadata": { "title": "Cinderella", "source": "Lang, The Blue Fairy Book, 1889", "created_at": "2026-08-20T00:00:00Z" }
}
```

**Versioning.** `schema_version` is the shape of this document itself, bumped only on breaking
changes to this schema. `package_version` is an author-facing integer the author increments on
meaningful content edits — not auto-incremented per save. A **Compiled edition** pins the
`package_version` it was compiled from (per `CONTEXT.md`), which is the granularity that matters
for diffing runs against each other; per-Scene-Card versioning would be over-engineering for a
POC with no concurrent multi-author editing.

`character_knowledge` rows are **not** part of the seed by default — a story typically starts
with characters knowing nothing beyond what's implied by the Fabula. Where the author needs a
character to start already knowing something, seed a row with `learned_at_scene: null`.

**Persistence path**, per [`docs/research/vercel-runtime.md`](../research/vercel-runtime.md):
`story/{storyId}/package.json` for the authored package; `edition/{runId}/world-model.json` for
the World Model tables' state at the close of a compiled run, same table shapes.

---

## What this schema deliberately does not settle

- **How a tier is enforced** — validation against `entry_state`/`exit_state`, unattended
  resolution of volitional proposals, diagnostics and severities. Issue #9.
- **The real fact-identity scheme behind `fact_ref`** — resolved in
  [The Scene Digest and the told-ledger](https://github.com/tschomay/axiom-weaver/issues/7) /
  [ADR 0003](../adr/0003-scene-digest-and-told-ledger.md): an author-declared or auto-generated
  slug, not required to correspond to a World Model row/column. Entity introduction uses an
  auto-generated `met:<entity_id>` fact.
- **Voice Card field-level shape** — carried opaquely in the envelope. Issue #11.
- **A global story clock / "time of day".** `CONTEXT.md` lists time of day as a physical
  property, but neither fixture needs it modeled per-entity, and it doesn't obviously belong on
  any of the four tables above — it reads more like run state than World Model state. Flagged
  for whoever picks up the read-time run loop (issue #19); not a gap in this schema so much as a
  fact this schema doesn't have a natural home for yet.
