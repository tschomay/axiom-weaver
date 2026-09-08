# ADR 0010: Repetition control via a domain-tagged imagery ledger

## Status

Accepted — settled in [Repetition and voice-drift control](https://github.com/tschomay/axiom-weaver/issues/14),
prototyped on the throwaway branch `prototype/repetition-voice-drift-control`
([prototype file](https://github.com/tschomay/axiom-weaver/blob/prototype/repetition-voice-drift-control/prototypes/repetition-voice-drift-control.prototype.html)).

## Context

At novel length the writer cannot detect "you have used rain-on-glass four times" by
re-reading prose it cannot afford to re-read — only `imagery_signature` (ADR 0003) is cheap
enough to carry forward. But the same Voice Card that names an `imagery_palette` (ADR 0007)
explicitly wants some of those images to recur across the whole telling — that recurrence is
a **motif**, not a failure. A mechanism that flattens both cases to "seen before, avoid" would
suppress exactly the texture the Voice Card is asking for.

Two of this ticket's own bullets — scene-shape variety and voice drift — reach into ground
[ADR 0002](0002-seam-failure-rubric-and-mechanism-ownership.md) already settled: uniform beat
shape is "consciously accepted as unaddressed for v1… revisit only if it proves visible at
novel scale," and voice drift is "generation-time only… no post-hoc mechanism catches a drift
that already happened." This ADR treats both as live questions worth re-checking against a
concrete prototype, not as settled ground to relitigate by default.

## Decision

1. **What gets recorded: nothing new.** `imagery_signature` (ADR 0003, capped at 3 entries)
   stays the only repetition signal. No verb ledger, no sentence-opener tracking, no
   sensory-channel field — each would cost digest tokens without independently catching a
   rubric mode `imagery_signature` doesn't already cover (ADR 0003's "a field earns its
   place" test still applies).

2. **Schema change: `imagery_signature` entries carry a domain tag.** Shape becomes
   `{image: string, domain: string | null}[]`, still capped at 3. The writer self-tags each
   recorded image against one of the Voice Card's `imagery_palette` entries at emission time
   (same call, no extra cost beyond a short label); `domain: null` marks an ad hoc image
   outside the palette. This is the one schema change this ticket makes.

3. **Normalization is domain-tag matching, not string or embedding similarity.** The writer
   already has to choose from (or knowingly step outside) `imagery_palette` to write the
   sentence — self-tagging that choice is free. Comparing tags at ledger-build time is a
   plain equality check, no extra call — consistent with the no-`lookup`-tool,
   deterministic-join constraint from ADR 0008.

4. **A palette domain is the motif declaration; the ledger governs only the vehicle within
   it.** "Preferred imagery (draw from these before inventing new ones)" (ADR 0007's
   rendering template) already licenses a domain to recur across the whole telling on
   purpose. The ledger instruction constrains reuse of the *same phrasing* inside a domain
   — it never suppresses the domain itself. Scheduling one specific image (not a whole
   domain) as a deliberate one-off callback is a real but separate need that neither fixture
   forces yet — left in `CONTEXT.md`'s Not yet specified fog, not built here.

5. **Instruction wording: positive-framed, appended after the Voice Card block.** Render an
   `IMAGERY LEDGER` block — recently-drawn-from domains with a short gist, plus an explicit
   "not yet drawn from" list — after the Voice Card block and before the scene's own tone
   instruction. The prototype hand-tested a raw blocklist ("do not use: ash, cinders,
   grate…") against the same three scenes: it suppressed the whole hearth-imagery domain
   rather than varying it, losing a beat-adjacent, characterful detail and reaching for
   flatter generic substitutes. A blocklist can't distinguish "don't repeat this phrasing"
   from "don't touch this domain," so it over-corrects — declined.

6. **Voice and ledger don't fight, by construction, not by a new rule.** Register, distance,
   and rhythm are the Voice Card's near-invariant identity fields (ADR 0007); the ledger
   block is scoped explicitly to imagery and rendered *after* the Voice Card block, so it
   reads as refinement within the voice rather than a competing instruction. The prototype's
   three "with ledger" excerpts hold voice constant while only the concrete image varies,
   confirming this without any wording change to ADR 0007's template.

7. **Scene-shape variety: not reopened.** ADR 0002 already ruled this "consciously accepted…
   revisit only if it proves visible at novel scale," and named revisiting it as new fog, not
   a reopening. Nothing here changes that: variety stays *permitted* via the author-set
   `length_budget` (which already differs per Scene Card — 350/300/200 across the three
   scenes used in the prototype), never *pushed* by a new mechanism. No digest field added.

8. **Voice drift: not reopened.** ADR 0002's ownership split stands — voice drift is
   generation-time-only, with no post-hoc verification step, full weight on the Voice Card.
   ADR 0007's sketch of anchoring drift-measurement against generated-prose stats (average
   sentence length, dialogue fraction) is **not adopted** as a continuity-pass-flagging
   mechanism: doing so would quietly reopen ADR 0002's split. This ticket's only contribution
   on voice drift is Decision 6 — confirming the ledger instruction doesn't itself introduce
   drift by fighting the Voice Card block in the same prompt.

## Consequences

- `docs/adr/0003-scene-digest-and-told-ledger.md` gets an addendum for the
  `imagery_signature` shape change, mirroring how ADR 0009 addended it for `reanchor_used`.
- The writer prompt contract (#16) can render the `IMAGERY LEDGER` block directly from this
  ADR's template, positioned after the Voice Card block per Decision 5/6, without re-deriving
  wording or ordering.
- The continuity pass (#15) inherits a concrete, digest-only signal for **stale imagery**
  (domain-tag repetition without vehicle variation across a window) — the one rubric mode
  this ticket actually strengthens detection for. It inherits nothing new for voice drift or
  uniform beat shape; both stay exactly where ADR 0002 put them.
- Rollup behavior (ADR 0003 Decision 6: union then re-cap to 3 by recency) is unchanged —
  it operates the same way on `{image, domain}` pairs as it did on bare strings.
- Single-image callback scheduling (a motif narrower than a whole palette domain) stays fog,
  not a ticket — speculative until a fixture or a later Story Package actually needs it.
