# Authoring notes: the two fixture Story Packages

Written while producing [`fixtures/cinderella/package.json`](./cinderella/package.json) and
[`fixtures/a-christmas-carol/package.json`](./a-christmas-carol/package.json) for
[issue #18](https://github.com/tschomay/axiom-weaver/issues/18), part of
[the map](https://github.com/tschomay/axiom-weaver/issues/1). Schema is
[`docs/schema/story-package.md`](../docs/schema/story-package.md) (ADR 0001, 0003, 0004, 0005);
scene breakdowns are from [`docs/research/fixture-stories.md`](../docs/research/fixture-stories.md).

Per the ticket, this file matters as much as the fixtures themselves — it's the first real signal
on the map's "Author onboarding" open question.

## The *Christmas Carol* merge-policy decision

**Decision: 20 Scene Cards via merging the finest-grain beats, not the 17-scene Staves I–III
fallback.**

This turned out not to be a close call once the ticket's own two "must include" requirements are
read against where they fall in the text:

- The long-range plant ("surplus population," planted line 394, paid off line 2302) lands inside
  **Stave III** — it would have survived the 17-scene fallback.
- The Stave IV withholding (the reader kept off the corpse's identity until the gravestone) is,
  definitionally, **in Stave IV**. There is no version of "Staves I–III only" that contains it.

So the fallback was never actually a live option for this ticket — it structurally cannot satisfy
one of the two things the ticket names as load-bearing. The only real decision left was how to
merge the ~28 finest-grain beats listed in `fixture-stories.md` down to a card count at the top of
the 12–20 band. The research file's own stated merges (three Stave III world-vignettes → one; two
school beats → one; two waking/turkey beats → one) don't quite land on 20 by themselves once
counted literally against its own bulleted breakdown, so two more merges were made and are
recorded in `_authoring_conventions.merge_policy` and inline in the affected cards:

- Stave I's three counting-house beats (Fred's visit, the portly gentlemen, Bob's dismissal) —
  same location, same continuous scene in Dickens — became one card (`scene_01_counting_house`).
- Stave I's knocker-becomes-Marley's-face and Marley's ghost + phantoms — one continuous haunting,
  same night, same room — became one card (`scene_02_the_haunting_begins`).

Everything in Stave IV was kept at full finest grain (6 cards, `scene_12` through `scene_17`)
specifically so the withholding has room to build across "~6 scenes," per the ticket's own framing
— this was the one place where merging for card-count economy would have directly undermined the
thing the fixture exists to test.

## Where the schema didn't fit

Ranked roughly by how much it cost, most expensive first.

### 1. No representation for a shown-but-unrealized possible future

This is the sharpest finding, and it's a **second** stress case beyond the one the ticket named
(Scrooge's redemption) — it surfaced organically while carding Stave IV.

The World Model is explicitly "ground truth *at the current moment*" (`CONTEXT.md`) — one row per
entity, one current value per column. But Stave IV's corpse is not a current fact: it's a
conditional future the Ghost of Christmas Yet to Come shows Scrooge, and Dickens is explicit that
it's contingent ("are these the shadows of things that Will be, or are they shadows of things that
May be, only"). Scrooge is alive and *present in the room* as a POV character for every one of
those six scenes. There is no schema-native way to say "this entity is dead" and "this entity is
alive and standing right here" at the same time, because there's only one World Model, not one per
hypothetical branch.

The workaround: give the corpse its own entity id (`char_dead_man`), never reusing `char_scrooge`'s
id, and never touching `char_scrooge.status` during Stave IV (he stays `"alive"` throughout, which
is also textually correct — he's a witness, not a participant). The identity claim the whole
sequence is built on — *this dead man is (a possible) Scrooge* — is carried by an ordinary
`relationship` row (`kind: "foretells_the_fate_of"`), seeded from the start of the World Model
(satisfying the ticket's "the World Model knows... from early on") but never surfaced to the reader
until the payoff scene. The reveal itself falls out of this cleanly and elegantly: it's nothing
more than a plain `name` column update on `char_dead_man`, from `"an unnamed dead man"` to
`"Ebenezer Scrooge"` — a normal P-tier write, no special mechanism needed. That part of the
workaround is genuinely a good fit, not just a patch.

What's missing is a first-class way to say "these two entities denote the same underlying thing,
in a hypothetical" — `foretells_the_fate_of` is honest about *that a link exists* but carries none
of the modal content ("this is avertable, not settled"). A future schema iteration that wants to
model conditional/counterfactual futures as more than a one-off relationship kind would need to
think about this properly; it wasn't worth generalizing off a sample size of one scene sequence.

### 2. `entry_state` / `exit_state` are typed `JSON` with no internal shape specified

Both fixtures needed *some* concrete convention to actually write these fields, and the schema doc
deliberately leaves the internal shape open (reasonably — it's not this schema's job to pin down
the writer's per-scene output format, which ADR 0005 assigns to issue #16/#19). But an author
sitting down to write real cards has to invent something today. The convention adopted here —
`{ <entity_id>: { <column>: <value> } }`, with the reserved keys `_new_relationships` and
`_new_character_knowledge` for rows a scene creates rather than updates — is documented at the top
of each package file and is a reasonable guess at where ADR 0005's "per-column, per-entity" update
shape (used for the *writer's* `state_updates`) is heading, but it's not settled anywhere the
schema doc points to. Worth either formalizing this shape in the schema doc directly, or explicitly
flagging that the Scene Card's `entry_state`/`exit_state` JSON shape is intentionally the same
shape `state_updates` will use, so authors and the runtime aren't inventing two different
conventions independently.

### 3. `reader_must_learn` / `must_stay_hidden` are reader-scoped; Cinderella's irony gap is
   character-scoped

The ticket asks that "both" irony gaps — Cinderella's (a *character* is ignorant while the reader
knows) and the *Carol*'s (the *reader* is kept ignorant) — "survive into the Scene Cards' 'what the
reader must learn / what stays hidden' fields." Having built both, I don't think they fit those
fields symmetrically, and the asymmetry is worth recording rather than smoothing over:

- The *Carol*'s gap is a genuine told-ledger fact: the reader doesn't know something the World
  Model already does. `must_stay_hidden` / `reader_must_learn` are exactly the right tool, used
  exactly as designed, in `scene_12`–`scene_17`.
- Cinderella's gap isn't a reader-knowledge fact at all — the reader has known Cinderella was the
  ball's mystery guest since `scene_06`. What's dramatized in `scene_09` is that *the sisters*
  don't know, in front of a reader who does. That's a `character_knowledge` fact (or rather, its
  deliberate *absence* — no row exists for the sisters knowing), not a told-ledger fact, and using
  `must_stay_hidden` for it would have meant naming a fact the reader already holds true as
  something to hide from them, which is simply wrong per the field's own definition.

  The package resolves scene 9 with `reader_must_learn: ["sisters_unaware_cinderella_attended"]` —
  a fact_ref for the reader's *confirmation* that the sisters remain oblivious, which is genuinely
  new reader-facing information even though it's about the sisters' ignorance rather than about
  Cinderella — plus `invariants` constraining that neither side gives the game away. It's a
  reasonable fit, but it required inventing a slightly indirect fact_ref rather than there being an
  obvious field for "this character must not learn X this scene." If a second character-ignorant
  fixture ever gets added, a character-scoped counterpart to `must_stay_hidden` (something like a
  per-scene "this character must not learn" list, distinct from the reader-facing one) might earn
  its place — one data point isn't enough to justify it yet.

### 4. Scrooge's redemption: the volitional-tier stress case, worked through concretely

This one the ticket named explicitly, so it got the most direct attention. ADR 0005 gives exactly
one lever for making a volitional outcome reliably land: bake it into `exit_state`, which "moves it
out of proposal territory entirely." The ticket asks for the opposite — modeled as *proposed*, not
committed. Concretely, that meant a discipline the schema doesn't enforce mechanically but does
support: **no Scene Card in the *Carol* package ever names `char_scrooge.goal` or a relationship
`sentiment` column inside an `exit_state`.** The redemption is carried entirely by `required_beats`
(pure narrative instruction — "he vows to sponge out the writing on the stone," "he laughs, cries,
talks to himself in delight") and reinforced with `invariants` that say outright why the WM columns
were left untouched (see `scene_18`, `scene_19`).

The honest consequence, also recorded inline: this makes "the redemption sticks" a *runtime*
property, not something the Story Package itself can guarantee. Every card between `scene_17` and
`scene_20` is written to make the accept/drop test in ADR 0005 §3 come out the same way on every
run — nothing in the invariants would ever contradict a proposal to soften Scrooge's goal or his
sentiment toward Fred and Bob — but by the tier's own design, that's *convergent-in-practice*, not
*guaranteed-by-schema*. That gap between "overwhelmingly likely" and "certain" is inherent to the
propose-only boundary working as designed, not a flaw in this package — but it's worth being
explicit that a Story Package author cannot, today, express "this volitional outcome is the whole
point of the story and must land" any more strongly than writing very good invariants and hoping.
This is the schema's own conscious tradeoff (ADR 0005 §3–4) showing up concretely for the first
time; the finding is that it's workable but leaves a visible seam.

### 5. Minor gaps, lower cost

- **No object-existence/lifecycle field.** Several objects don't exist until a scene creates them
  (the coach, the ball gown, the glass slippers; the prize turkey). `status: "not_yet_created"`
  works as a free-text convention but it's a hack riding on a column that's semantically about
  physical condition (`intact`/`broken`/`lost`), not existence. A dedicated boolean or lifecycle
  enum would be cleaner if this pattern recurs.
- **Renaming instead of creating new objects for transformations** (pumpkin → coach, mice → horses,
  rat → coachman, lizards → footmen) turned out to be a *good* fit, not a gap — Principle 1's
  "identity is a stable slug, name is an ordinary mutable column" handles Cinderella's
  transformation magic for free, and reverting the name at midnight (`scene_10`) is just as clean.
  Recorded here as a positive finding, since it wasn't obvious in advance that this would work so
  well.
- **The envelope's example JSON under-documents its own prose.** The schema doc's envelope example
  shows `world_model_seed` with only `characters`/`locations`/`objects`/`relationships`, but the
  prose immediately below it describes seeding `character_knowledge` rows with
  `learned_at_scene: null`. The *Carol* package needed exactly this (to seed-ground the corpse
  reveal's `pays_off`), so it adds a `character_knowledge` array under `world_model_seed` — legal
  per the prose, just not shown in the abbreviated example. Worth updating the example to include
  it so a future author doesn't have to notice the same gap.
- **No natural WM home for a raise in wages** (`scene_20`, Bob's salary). Left as `required_beats`
  prose rather than forcing a bag key or a new column — not every fact needs to be structured data,
  and this one never gets referenced again, so a column would be dead weight of exactly the kind
  ADR 0001's governing principles warn against inventing pre-emptively.
- **`pov` assumes a single character physically anchoring the scene**, which is a small mismatch
  with classic fairy-tale omniscient narration. Cinderella's `scene_12` (the slipper's circuit
  around the kingdom) has no coherent character to assign `pov` to if it must be someone actually
  present and central — Cinderella isn't in the scene at all. Resolved by assigning `pov` to
  whichever named character the scene *is* anchored to (the gentleman-in-waiting), which works but
  quietly stretches "POV" from "whose eyes we're behind" to "who this scene is about," and those
  aren't quite the same thing. Not worth a schema change for one scene out of 34 across both
  fixtures, but the field's implicit assumption (one character, present, focal) is worth naming.

## How long it took, and what was tedious

This was one continuous authoring session (no live back-and-forth — the ticket is explicitly
scoped as pure manual work). Rough breakdown by where the effort actually went, not by clock time,
since a single-session estimate of wall-clock time would be more misleading than useful without a
second data point to compare it against:

- **Reading the four required documents closely enough to author against them precisely** (schema,
  three ADRs, the research file) was the single largest fixed cost, and it's a **one-time** cost —
  the second package (the *Carol*) went noticeably faster than the first (Cinderella) once the
  conventions above were settled, even though the *Carol* has ~40% more scenes and more than double
  the characters. That's the clearest quantitative signal here: **template/convention reuse across
  packages saves real effort**, which speaks directly to the map's open "author onboarding"
  question — a second story in an established Story Package "house style" is materially cheaper
  than the first.
- **The genuinely tedious part was bookkeeping, not creative decision-making**: keeping
  `characters_present` arrays, `entry_state`/`exit_state` entity references, and `pays_off`/
  `reader_must_learn` fact_ref pairs all mutually consistent by hand, across 34 scenes total, is
  exactly the kind of mechanical cross-referencing a linter earns its keep on. A validation script
  was written and run against both packages specifically because doing this by eye was already
  producing small mismatches (a scene referencing a location id that had a typo, a `pays_off` whose
  plant scene hadn't actually declared the fact) well before either package was half done. **This
  is the strongest concrete argument on the map's "templates or generators" question**: not that
  authoring the *content* needs automation (the plot decisions were the fast part), but that
  **schema-conformance checking absolutely should be tooling, not author discipline** — a
  human-authored package without an equivalent of this validation pass would ship silent plant
  dead-ends and undeclared entity references, and ADR 0004/0005's whole design assumes those
  errors get caught before generation, not after.
- **Deciding what *not* to model was real effort, and is invisible in the output.** Multiple
  reasonable expansions were consciously cut to avoid schema bloat: individual named lords for
  Cinderella's sisters' marriages, the two portly gentlemen as separate characters, a formal
  `possesses` relationship for every costume change. Each cut was a judgment call under Principle 4
  ("the moment a bag value needs structure, promote it") applied in reverse — deciding a fact
  *doesn't* need a row at all. This kind of restraint doesn't show up as a line in the file, but it
  took real thought per decision, repeated dozens of times across both packages.
- **The plant/payoff chains and the Stave IV withholding were, unexpectedly, the *fast* parts.**
  Both ADR 0003's `fact_ref` design and ADR 0004's plant-obligation shape are precise enough that
  encoding them was closer to filling in a form than making decisions — the hard thinking had
  already been done by the tickets this one is downstream of. The genuinely open design work in
  this session was almost entirely in the two friction points above (the hypothetical-future
  problem, the character-vs-reader-scoped irony gap) — both of which are things *this* schema
  didn't anticipate, not things the earlier tickets left unfinished.

**Bottom line for the "author onboarding" question this ticket exists to measure**: the schema
itself is not the bottleneck — every fact in both stories found a home, sometimes with a documented
workaround but never with real loss of fidelity. The bottleneck is the *volume* of mechanical
cross-referencing a real Story Package requires, which scales with scene count and entity count in
a way a human author will get wrong by hand past a certain size. A generator is probably overkill
for a story this size, but **a schema-conformance linter (the plant-obligation walk's three
validators, plus reference-existence checks on `pov`/`location_id`/`characters_present`/
`entry_state`/`exit_state`) is not optional tooling — it's load-bearing for author-time authoring at
any scale beyond a short story**, and should probably ship alongside whatever picks up issue #16.
