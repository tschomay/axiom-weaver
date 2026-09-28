# ADR 0022: Fact statements and the hidden account

## Status

Accepted — settled in [issue #179](https://github.com/tschomay/axiom-weaver/issues/179). Amends
[ADR 0003](0003-scene-digest-and-told-ledger.md) decision 1 (a `fact_ref` is a bare slug) and
[ADR 0019](0019-fabula-only-packages.md) (`caused_by` is not carried into the Story Package).

## Context

In the generated *The Slackwater Crossing* (telling
`the-slackwater-crossing-20260919112631-185fa9f9`), scenes 8 and 10 have Jesse throw the ferry into
reverse, which jams the rudder over. Scene 9's prose has Nita say Jesse "reversed the screw because
he had no tiller": cause and effect swapped. The edition's own records show where the order was
lost:

- Scene 8's digest had it right ("the rudder over-rotated during reverse throttle due to missing
  stop blocks").
- The rollup over scenes 5–8 that scene 9's writer read compressed it to "missing rudder stop
  blocks caused the disaster". The reverse was gone.
- Scene 9's card named only slugs (`teague_admits_modifying_rudder_stops`). A slug carries no claim
  and no direction.
- The Fabula never said *why* Jesse reversed, and its `caused_by` graph modelled the investigation
  (dredge → decode whistles → inspect rudder), not the incident being investigated.

So a scene that retold the incident had to rebuild it from digests, and a recap is where order gets
lost. Nothing in the package held a fixed account to paraphrase.

## Decision

1. **A fact may carry a statement.** The Story Package gains an optional top-level `facts` table:

   ```
   facts: [{ fact_ref, statement, caused_by: [fact_ref, …] }]
   ```

   `fact_ref` stays a slug and stays the identity. Every mechanism that matches facts (the
   told-ledger, `facts_revealed`, the plant walk) still matches slugs. The statement is **the claim
   the slug stands for**, in one sentence. `caused_by` names the facts this one follows *from*:
   causes, not merely earlier facts. A package without the table behaves exactly as before.

2. **Wherever a slug reaches the writer, its statement goes with it.** That covers
   `reader_must_learn`, `must_stay_hidden`, plant and payoff instructions, `WHO KNOWS WHAT` rows,
   and told-ledger rows.

3. **The causal account is rendered, in order, as part of the mandatory core.** When a scene names
   a fact that has causal links, the writer gets an `ESTABLISHED ACCOUNT` block. It holds every
   fact connected to the scene's own facts through `caused_by`, listed causes-before-effects, each
   labelled with where the reader stands: already knows / reveal here / resolve here / MUST STAY
   HIDDEN / not yet told, do not state. The block tells the writer that any retelling, recap or
   accusation in the scene keeps this order and direction. It sits in the core rather than an
   evictable tail group, because a recap without it is the failure this ADR exists to stop.

   Rendering linked facts the reader has not been told is deliberate. The writer already holds
   every `must_stay_hidden` slug. A mystery's writer who does not know the true account can only
   guess at it, and a guess is how scene 9 happened. The per-fact label is what keeps knowing it
   from becoming telling it.

4. **Generation emits the hidden account as its own chain.** The arc response gains two blocks:
   - `hidden_account`: the concealed incident (or backstory) as chronological steps
     `{id, sequence, summary, caused_by, establishes}`. `caused_by` names earlier steps.
     `establishes` names the fact_refs the step makes true.

     This chain is separate from `events`: events model what happens *on the page*, usually the
     discovery, and the hidden account models what actually happened. In the Slackwater case the
     steps would be: Teague pulls the stop blocks → Jesse reverses *because X* → the rudder
     over-rotates and wedges the shaft (caused by both) → the gland tears and she floods.
   - `facts`: a statement for every fact_ref the arc uses.

   Both ride in the `_fabula` block, alongside `events` (ADR 0019).

5. **Segmentation lifts them into the package.** `facts` is the arc's `facts` table merged with
   the hidden account. A fact a step establishes takes the step's summary as its statement when the
   table has none. It also inherits, as `caused_by`, the facts established by the steps that step
   was caused by. The event-level `caused_by` still stops at the boundary, as ADR 0019 said. What
   crosses is the *fact*-level graph, which is what a retelling needs.

6. **The linter checks the table's shape.** These fire only when the table is non-empty:
   - errors: a duplicate entry, a `caused_by` naming a fact the table does not hold, and a cycle;
   - warning: a fact_ref a Scene Card uses (`reader_must_learn`, `must_stay_hidden`, `pays_off`)
     that has no statement.

## Consequences

- The two failure paths #179 named are both closed:
  - *writer reconstructs the incident from lossy recaps*: the account is now a fixed text in the
    prompt;
  - *the Fabula never states the reason*: the hidden account makes "Jesse reversed because X" a
    step the generator must write, and #180's lint then checks every step after the first has a
    cause.
- Prompt size grows with the number of linked facts a scene touches, in the uncached volatile
  tail. For a mystery's solution scene that is the whole hidden account: a handful of sentences.
- Hand-authored and extracted packages carry no table, so they are unchanged. An author can add
  statements to an existing package by hand. The editor has no form for the table yet, so it rides
  through the Manuscript like any other block the forms do not show (ADR 0017 §2).
- Not done here, and still worth doing: a digest-level check that a scene's `event_summary` does
  not contradict an established statement. Note it would not have caught Slackwater scene 9: its
  digest omitted the inverted claim, which lived only in the prose.

## Follow-up (2026-09-28): every concealed fact is revealed, every hidden step is caused

[Issue #180](https://github.com/tschomay/axiom-weaver/issues/180). In Slackwater,
`rudder_overextension_cause` and `reverse_throttle_meaning` were concealed in scenes 2 and 4 and
then never put in any scene's `reader_must_learn`, so the told-ledger never recorded the story's
solution and nothing noticed.

- **`concealed_never_revealed`** (package lint, warning): a fact in some scene's
  `must_stay_hidden` that no later scene reveals (`reader_must_learn` or `pays_off`). For a
  generated **mystery** it is promoted to a repair target. That shape's solution is "the true
  account, assembled only from what the reader has already been shown", so a secret never
  revealed means the solution is missing. `unpaid_fact` now exempts a fact that an earlier scene
  concealed, since the reveal is what pays the concealment off.
- **`uncaused_hidden_event`** / **`hidden_cause_not_earlier`** (Fabula-layer errors, in
  `lintFabulaArc` and the arc repair targets): every hidden step after the first names an earlier
  step as its cause. A step with no stated cause is where a writer later invents one. The repair
  vocabulary gains `add_hidden_cause`, which can also rewrite the step's summary to say why.
  `hidden_step_establishes_nothing` warns about a step whose facts can never reach the writer.
- **Segmentation gives each concealed fact a reveal scene**: the first later scene holding an event
  that pays it off, or failing that the first later scene holding an event of the brief's Solution
  phase. It never invents one beyond that; the warning above reports the rest.
