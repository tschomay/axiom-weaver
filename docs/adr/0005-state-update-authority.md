# ADR 0005: State-update authority — validation, unattended resolution, and diagnostics

## Status

Accepted — settled in [State-update authority: what the engine may commit](https://github.com/tschomay/axiom-weaver/issues/9).

## Context

[Schemas for the Story Package and World Model](https://github.com/tschomay/axiom-weaver/issues/2)
(ADR 0001) fixed the tier — physical (P) / epistemic (E) / volitional (V) — as a static, per-column
schema attribute, and named this ticket as the place the tier gets *enforced*. [The seam-failure
rubric](https://github.com/tschomay/axiom-weaver/issues/3) (ADR 0002) additionally assigned this
validator ownership of **amnesia**, the single most severe failure mode, on the grounds that it's
a World Model contradiction rather than a Discourse Record continuity problem.

The worked example from the ticket: the author writes a scene where Jim walks to the park. The
engine looks up that Jim is at home, reads what the park is, writes the walk, and commits
`Jim.location = park` — legitimate, because it's the scene the author asked for. What the engine
must not do is decide Jim gets mugged on the way. The four sub-questions to settle: what the
validator accepts/rejects/flags, how a volitional proposal resolves with no author present,
whether run-to-run divergence on a volitional column is a bug, and what diagnostics look like.

## Decision

### 1. Two checkpoints, not one

- **Pre-generation (entry check).** Before the writer runs, the validator compares the Scene
  Card's declared `entry_state` against the actual current World Model row values for every
  entity in `characters_present`, on P/E columns only. A mismatch means the author's card no
  longer describes the world it's about to be layered onto — `entry_state_mismatch`, hard error.
- **Post-generation (state-update validation).** After the writer emits prose + digest +
  `state_updates` in one structured call (ADR 0003), the validator checks every proposed update
  before it's committed to the World Model. This is the checkpoint the rest of this ADR
  specifies.

Because entry_state is re-checked at every scene rather than assumed from the Story Package's
authoring-time shape, a Scene Card downstream of a run where a volitional proposal diverged (see
§3) still gets validated against what's *actually* true in that run's World Model, not what the
author assumed when writing the card in isolation.

### 2. Accept / reject / flag, by tier

**Physical and epistemic** are auto-committed, but "writes freely" means no approval gate — not
that any value is accepted. A proposed P/E update is:

- **Accepted as an extension** when its column isn't named in `exit_state` and it doesn't
  contradict any `entry_state`/`exit_state` value already asserted. This is ordinary texture (Jim
  now also happens to be carrying an umbrella) — no rubric mode cares about it and ADR 0001 never
  made it an author-controlled invariant.
- **Accepted as satisfying the invariant** when its column *is* named in `exit_state` and the
  value matches. This is the walk-to-the-park case: `Jim.location = park` is exactly what
  `exit_state` required.
- **Rejected — `exit_state_contradiction`** when its column is named in `exit_state` and the
  value differs. The exit state is the author's invariant (`docs/schema/story-package.md`); an
  engine value that disagrees with it isn't an extension, it's the engine overruling the author.
- **Rejected — `unauthorized_entity_update`** when it targets an entity absent from the scene's
  footprint (`characters_present`, its `location_id`, or an object not referenced by the scene).
  The scene gave the engine no narrative reason to touch that entity, so a silent update to it is
  invented plot by omission — the mugging-on-the-way case, generalized to "anything the author
  didn't ask this scene to touch."
- **Rejected — `unentailed_reversion`** when it changes a column *away from* its currently
  committed value and that new value appears nowhere in `entry_state`, `exit_state`, or
  `required_beats`. This is the amnesia guard proper: reverting `status: injured` back to `alive`
  with no requested healing beat is the engine forgetting its own prior commitment, which is
  exactly what a reader-facing amnesia failure is made of. Combined with the pre-generation entry
  check (§1), this closes the loop ADR 0002 opened: entry_state guarantees the engine *starts*
  from true premises; `unentailed_reversion` guarantees it doesn't *drift away* from them
  mid-scene without the author asking it to.

**Volitional/relational** updates are never auto-committed — they're captured as **proposals**
and resolved per §3.

### 3. Unattended resolution has one rule: apply, or don't

At read time there's no author to confirm a volitional proposal, and the reader must never see a
prompt. So the engine does not "decide" in the sense of picking a favored outcome — it tests the
proposal against the scene's own invariants (`exit_state`, `required_beats`) and:

- **Applies and commits** the proposal if nothing in those invariants is violated by it.
- **Drops** it — the World Model keeps its prior value, nothing is invented in its place — if it
  would contradict an invariant, *or* if the card gives no signal either way. Silence defaults to
  inaction, never invention; this is the same "compiler never invents plot" rule ADR 0004 applied
  to plants, applied here to feelings and allegiances.

There is no third option (author-time default, engine "deciding within invariants" beyond this
accept/drop test) — a card that wants a volitional outcome to reliably land states it as a
required beat or bakes it into `exit_state`, which moves it out of proposal territory entirely.

### 4. Divergence across runs is accepted variance, bounded by the same test

If run A's proposal is compatible with the invariants and run B's differs but is *also*
compatible, both commit as proposed and the World Model genuinely differs between runs on that
column. This is not a bug — it's the same class of variance CONTEXT.md's variance contract
already grants to dialogue and imagery, just landing on a V-tier column instead of prose. What
the accept/drop test guarantees is that divergence is always *within* the declared invariants:
two runs can never diverge into a state either author-declared invariant forbids, because a
proposal that would violate one is dropped identically in every run. Physical and epistemic
columns don't get this freedom — §2's rules make every accepted P/E update either required by
`exit_state` or a non-narrative extension, so they're deterministic across runs by construction,
which is what keeps "same story, told uniquely" from meaning "different facts, told arbitrarily."

### 5. Diagnostics and severity

Three severities, and — per the map's Notes ("nothing may block on an author who is not there")
— **none of them abort a read-time run**:

- **`error`** — `entry_state_mismatch`, `exit_state_contradiction`, `unauthorized_entity_update`,
  `unentailed_reversion`. Author-time: surfaces immediately as a compile warning, no retry, same
  as ADR 0004's plant-obligation misses — the author is present and can just fix the card.
  Read-time: one bounded retry restating the contradiction (mirroring ADR 0004's retry for
  dropped setups); if the retry doesn't resolve it, the validator falls back to the World Model's
  pre-scene value for that column — never the engine's proposed value — and logs the diagnostic
  to the run report at `error`. The World Model is never corrupted by a misbehaving update; the
  cost is a logged inconsistency instead, matching `CONTEXT.md`'s "Stale... flagged, never
  auto-recompiled" preference for a visible gap over silent corruption.
- **`warn`** — a volitional proposal dropped because the card gave no signal (not because it
  violated anything). Logged as `dropped_proposal`; not an authoring problem, just recorded so
  issue #20 (compiled editions) can diff which proposals landed in which run.
- **`info`** — an accepted volitional commit. Logged for the same run-diffing purpose.

## Consequences

- `docs/schema/story-package.md`'s "what this schema deliberately does not settle" pointer to
  this ticket is resolved; the Scene Card's `entry_state`/`exit_state` fields now have a concrete
  enforcement mechanism.
- Issue #16 (writer prompt contract) must have the writer emit `state_updates` as a per-column,
  per-entity list (not free-form prose description of state), since §2's rules validate at
  column granularity.
- Issue #19 (read-time run loop) implements the retry-then-fallback flow in §5 as part of its
  per-scene step.
- Issue #20 (compiled editions and staleness) gets its first concrete diff surface for volitional
  divergence: the `info`/`warn` log lines from §5, not a full World Model diff.
- Uniform beat shape and the two voice-level rubric modes remain untouched by this ticket, per
  ADR 0002's ownership split — this validator's remit stops at amnesia.
