# ADR 0017: The Manuscript, and publishing a Story Package

## Status

Accepted — settled in [The authoring surface: create, edit and duplicate a Story Package](https://github.com/tschomay/axiom-weaver/issues/84),
which graduates the map's **author onboarding** fog item
([#1](https://github.com/tschomay/axiom-weaver/issues/1), [#38](https://github.com/tschomay/axiom-weaver/issues/38))
into build work.

## Context

Every Story Package in this repository was authored in a text editor and loaded from
`fixtures/`. That was the right call while the compiler was the thing being proved — but it
leaves the project with no answer to the most basic authoring question there is: *how does a
person who is not holding a JSON file get a story into this system at all?*

[`fixtures/authoring-notes.md`](../../fixtures/authoring-notes.md) and issues
[#18](https://github.com/tschomay/axiom-weaver/issues/18) and
[#16](https://github.com/tschomay/axiom-weaver/issues/16) already measured where hand-authoring
actually hurts, and it is not the prose. It is **mechanical cross-referencing**: entity ids,
`pays_off`/`reader_must_learn` fact-refs, `characters_present` omitting a character who is on the
page (the godmother, Cinderella scene 13), an `exit_state` naming an entity who is absent (the
Prince, same scene). Both are errors a schema-conformance check catches for free and a human
re-reading their own JSON does not. The map's own conclusion was that a **linter**, not a
generator, is the first authoring tool worth building.

So the surface this ADR settles is a structured editor over the Story Package, with continuous
validation — not a content generator. What makes it more than a form is one collision the
existing persistence model walks straight into.

**The collision.** `StoryRepository.putPackage` refuses to rewrite a retained `package_version`
with different content ([ADR 0015](0015-compiled-editions-and-staleness.md) §2/§4), because a
Compiled edition pins a version and must dereference to the bytes it was actually compiled from,
forever. That invariant is load-bearing and is not up for renegotiation. But an author editing a
scene generates a write every few seconds, and every one of those writes is *content that differs
from the retained version*. Three ways out, and they are genuinely different projects:

1. **Every save bumps `package_version`.** Trivial to build, and wrong: an afternoon's editing
   leaves fifty retained snapshots, and — worse — ADR 0015's blunt staleness propagation fires on
   every one of them, so the Working Draft is permanently a wall of stale badges. Staleness stops
   carrying information.
2. **A version stays mutable until something pins it.** Fewer junk snapshots, but "is this version
   frozen yet?" becomes state the author has to hold in their head, and the freeze moment is a
   side effect of an unrelated action (compiling a scene).
3. **A separate mutable buffer, published explicitly.** Editing never touches a retained snapshot;
   one deliberate action turns the buffer into the next `package_version`.

## Decision

### 1. The Manuscript

A **Manuscript** is a per-story, mutable, unversioned working copy of a Story Package — the
author's editing buffer. It lives at `story/{storyId}/manuscript.json`, at most one per story, and
it is **the only thing an edit ever writes**. Retained `package_version` snapshots stay immutable
and `putPackage`'s conflict error stays a real invariant rather than an obstacle to route around.

The Manuscript carries the package envelope plus three authoring fields the package itself has no
business holding:

```jsonc
{
  "based_on_version": 3 | null,   // the retained version this was opened from; null = never published
  "updated_at": "2026-09-11T…",   // the optimistic-concurrency precondition (§8)
  "package": { /* the Story Package envelope, loosely parsed — see §2 */ }
}
```

Nothing in the compiler ever reads a Manuscript. The Working Draft, the run loop, the inspector
and every edition continue to resolve through `story/{storyId}/package.json`, exactly as now. **A
story with an unpublished Manuscript is, to every other surface in the system, unchanged** — which
is the property that makes leaving a half-finished edit lying around safe.

*On the name.* "Manuscript" ordinarily means prose, and prose is precisely what this is not — it
is the score, not the performance. It is used anyway because it is the one available word with the
right authorial register that does not collide with **Working Draft** (already the accumulating
sequence of *compiled scenes*, ADR 0015 §1); "package draft" sits one word away from "Working
Draft" and would be misread constantly. The glossary entry makes the distinction explicitly.

### 2. A Manuscript is parsed loosely; a published package is parsed strictly

`StoryPackageSchema` requires `scene_cards` to be non-empty and requires `pov`, `location_id`,
`dramatic_function` and both state blocks on every card. A story being written from scratch
satisfies none of that for its first hour, so a Manuscript is stored under a **relaxed** schema:
every required field is optional or nullable, arrays may be empty, and ids may be blank.

This is not a second schema to maintain in parallel — it is `StoryPackageSchema` with a
`.partial()`-style relaxation and the same field names throughout, so a Manuscript that *is*
complete parses as a Story Package unchanged. The strict parse happens at exactly one moment:
publish.

### 3. Publish is the only write that advances `package_version`

Publishing runs in one order and stops at the first failure:

1. Strict-parse the Manuscript's `package` as a Story Package.
2. Run the linter (§4). Any `error` stops here.
3. Assign `package_version = max(retained versions) + 1` — never the author's arithmetic, and
   never a reuse of `based_on_version`, so a publish can never collide with a version an edition
   already pins.
4. `putPackage` — retain the snapshot, repoint `package.json`.
5. Leave the Manuscript in place, with `based_on_version` advanced to the version just written.

Step 5 is deliberate: discarding the buffer on publish would mean the author's next edit starts by
re-reading the package they just wrote, and an accidental publish would be unrecoverable from the
screen. "Discard" is its own action (§9).

The consequence that matters: **staleness propagates exactly once per publish**, not once per
keystroke. ADR 0015's blunt propagation was chosen on the assumption that a `package_version` bump
is a deliberate authorial act, and this decision is what makes that assumption true now that
editing is a screen rather than a text editor.

`package_version` therefore stops being something an author types. ADR 0015 and the schema doc both
describe it as "author-facing, incremented on meaningful content edits" — after this ADR the
*publish action* is that increment, which is the same rule with the manual arithmetic removed.

### 4. The linter: two severities, and only one of them blocks

One module answers "what is wrong with this package", and every surface reads it — the authoring
screen continuously, the publish path as a gate, and `npm run load-fixtures` as it already does.
It composes what already exists (`WorldModel.referenceProblems`, `sceneCardProblems`, the
plant-obligation walk's three hard errors from [ADR 0004](0004-plant-obligation-walk.md)) rather
than inventing a second opinion about correctness.

**`error` blocks publish.** Every one is a defect that would otherwise fail at compile time, more
expensively and further from the field that caused it: a schema-shape violation, a reference to an
entity or scene that does not exist, a duplicate `order`, a `pov` absent from its own
`characters_present`, a payoff whose plant is a later scene or does not declare the fact.

**`warn` never blocks.** A warning is a judgment about craft or completeness, and an author is
allowed to disagree with it or to publish mid-thought: a scene with no `required_beats`, an entity
in the seed no scene ever uses, a `reader_must_learn` fact nothing pays off, a Voice Card left at
its preset. Warnings are shown where the problem is, not in a list the author learns to dismiss.

Both severities carry a **path** (`scene_cards.scene_04_godmother.characters_present`) so the
screen can link a problem directly to the field that owns it. A problem the author cannot navigate
to is a problem they will not fix.

### 5. Three entry points, one Manuscript

- **New** — an empty Manuscript. `story_id` is slugged from the title, checked against existing
  story ids, and **fixed once published**; every edition, run and blob path is keyed by it. Before
  the first publish it is still free to change.
- **Edit** — a Manuscript seeded from the story's current package.
- **Duplicate** — a Manuscript seeded from *any retained version of any story*, under a new
  `story_id`, with `package_version` restarting at 1 and `based_on_version: null`. Nothing else
  travels: no Working Draft, no Compiled editions, no runs, no Baked pointer. Entity ids keep
  their slugs — they are story-scoped, so `char_cinderella` in two stories is two rows, not a
  collision.

Duplicate is what makes the five fixtures function as templates: starting from
`the-dragon-of-thistlewick` (3 scenes, a complete plant chain, a filled Voice Card) is a
categorically easier first authoring experience than starting from an empty seed, and it is the
nearest thing to the "templates" half of the map's author-onboarding fog that does not require
building a template system.

### 6. What the screen edits directly, and the one escape hatch

Structured fields get structured controls, and **the author never types an id**: `pov`,
`location_id`, `characters_present`, relationship endpoints and every entity reference in a state
block are pickers over the World Model seed. That is a direct response to #18's finding — the
errors hand-authoring produces are cross-reference errors, and a picker cannot produce one.

`entry_state` / `exit_state` are edited as **rows**, not as JSON: entity → column → value, where
the column list comes from `src/schema/tiers.ts` and shows its P/E/V tier inline, so the author
can see that asserting `goal` is a volitional assertion at the moment they assert it. The reserved
`_new_relationships` / `_new_character_knowledge` keys are their own "add a row this scene creates"
affordances rather than raw keys the author must know to type. Bags are flat key/value pairs, with
Principle 4 (no nested objects) enforced by the control rather than documented at the author.

The escape hatch is **import/export of the whole package as JSON**, validated through the same
linter on paste. It costs almost nothing, it round-trips the existing fixtures, and it means an
authoring gap is never a dead end — which is what makes it acceptable for the forms to stay
deliberately narrow.

### 7. Mobile is a drill-down, not a shrunken desktop

Everything is editable on a phone. Desktop puts the scene list and the editor side by side; narrow
viewports stack into list → one scene → one field group, with the current scene addressable by its
own URL so the platform back gesture is the navigation. Nothing that must be edited is ever a
horizontally scrolling grid — the state editor is a list of rows at every width, which is the same
control on both, not a mobile variant to keep in sync.

### 8. Concurrency: last write wins, but says so

Every Manuscript write carries the `updated_at` it was read at. A mismatch is rejected and the
screen says the Manuscript changed elsewhere, rather than silently discarding the other tab's
work. This is a single-author POC ([ADR 0015](0015-compiled-editions-and-staleness.md) §5); the
precondition exists because two tabs on one phone is the likely case, not because multi-author
editing is in scope.

### 9. Discard, and what is not deletable

**Discard** drops the Manuscript and returns the story to its published package. It is the only
way to abandon an edit, and it is the reason publish does not clear the buffer.

Deleting a whole **story** is out of scope. Retained versions are pinned by editions that must
keep dereferencing, and there is no cascade worth designing at POC scale. An unpublished
Manuscript for a story that has never published is the one case with nothing behind it, and
discarding that one does remove the story.

### 10. The seam for generated Scene Cards, unbuilt

Every Scene Card editor opens against a **card source**, and this ADR ships exactly two: `blank`
and `duplicated-from`. A model-proposed source would slot in at the same seam without reworking
the editor.

It is not built, and this ADR does not reopen the question. The map ruled **procedural Syuzhet** —
the engine drafting Scene Objectives for the author to accept — out of scope for v1 while naming
it "the natural path to co-authoring rather than performance". That exclusion stands. What is
recorded here is only that the editor's shape does not foreclose it.

## Consequences

- `CONTEXT.md` and `GLOSSARY.md` gain **Manuscript** and **Publish**, placed alongside Working
  Draft in the Compilation section, with the Manuscript/Working Draft distinction stated
  explicitly in both.
- [`docs/schema/story-package.md`](../schema/story-package.md)'s versioning note is amended: the
  author no longer increments `package_version` by hand — publishing does, as
  `max(retained) + 1`.
- ADR 0015 §2/§4's immutability invariant is **preserved rather than relaxed**; this ADR exists
  largely to avoid relaxing it.
- ADR 0015 §3's blunt staleness propagation gets the deliberate-edit boundary it assumed:
  one propagation per publish.
- `src/fixtures/load.ts`'s `sceneCardProblems` becomes one input to the shared linter rather than
  the only validation surface. Fixture loading keeps its current behavior.
- The map's **author onboarding** fog item is partly resolved: the linter and the structured
  editor are built; templates-as-duplication is covered by §5; import is covered by §6;
  *generation* is explicitly still deferred (§10).
- A fifth author surface joins ADR 0016's four. ADR 0016's set was scoped to surfaces that
  *feed the mechanics* with information the compiler produces; this one runs the other way —
  it is where the Story Package the mechanics consume comes from — so it extends that set
  rather than contradicting its four-way collapse.
- No reader-facing surface changes. A reader sees a story only through published versions, and
  a Manuscript is invisible to every read path.
