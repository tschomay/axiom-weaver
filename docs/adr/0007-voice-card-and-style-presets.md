# ADR 0007: The Voice Card and its style presets

## Status

Accepted — settled in [The Voice Card and the style presets](https://github.com/tschomay/axiom-weaver/issues/11),
prototyped on the throwaway branch `prototype/voice-card-style-presets`
([prototype file](https://github.com/tschomay/axiom-weaver/blob/prototype/voice-card-style-presets/prototypes/voice-card-style-presets.prototype.html)).

## Context

The map's Notes named the Voice Card as a first-class object with a working field set and
noted that style presets should expand into an editable card rather than act as opaque
tags, but left the fields unvalidated, the presets unnamed, and the override/rendering/
modulation mechanics unspecified. Voice drift and character-voice homogenization are two
of the seam-failure rubric's failure modes (ADR 0002) that are constitutionally
undetectable from digests and therefore generation-time-only — this ticket is the only
mechanism that can address them, so the card had to be shown to actually move the prose,
not just look plausible as a schema.

## Decision

1. **Eight-field schema, validated by generation.** `person`, `tense`,
   `narrative_distance`, `register`, `sentence_rhythm`, `imagery_palette`,
   `dialogue_density`, and an optional `style_exemplar` (empty by default). Five fully
   filled Voice Cards were rendered into prose against the identical Cinderella
   `scene_01_remarriage` (same beats, entry/exit state, tone) and produced five
   genuinely distinguishable narrators. `sentence_rhythm` and `imagery_palette` carried
   the most visible differentiation; `person`/`tense` were held constant (third/past) in
   every preset tested, so their effect on differentiation is unconfirmed — worth a
   follow-up with a first-person or present-tense preset before treating the field set as
   fully proven. `dialogue_density` also couldn't be exercised, since the tested scene has
   no dialogue beats; kept in the schema on the strength of the seam-failure rubric
   (character-voice homogenization is dialogue-sensitive) but flagged unconfirmed rather
   than proven.

2. **Five presets validated:** Fairy-Tale/Fable (the baseline already in use across the
   fixture Story Packages), Gothic/Brooding, Whimsical/Playful, Hardboiled/Terse, and
   Lyrical/Literary. Full field values and generated samples are in the prototype.

3. **Prompt rendering.** The Voice Card renders as a fixed instruction block, kept
   textually separate from the scene's own tone instruction:

   ```
   VOICE (story-level, stable across the whole telling):
   - Point of view: {person}, {tense} tense. Narrative distance: {narrative_distance}.
   - Register: {register}
   - Sentence rhythm: {sentence_rhythm}
   - Preferred imagery (draw from these before inventing new ones): {imagery_palette}
   - Dialogue: {dialogue_density}
   - Exemplar, for calibration only — do not reuse its content: "{style_exemplar}"   [omitted if empty]

   SCENE TONE (this scene only — shapes emphasis and imagery selection, never overrides the voice above):
   {scene.tone}
   ```

   A flat attribute list reads as description, not instruction; pairing each field with
   concrete texture (imagery domains, a rhythm rule with an example) is what produced the
   differentiation in the prototype. Feeds directly into the writer prompt contract
   (issue #16).

4. **Field-level override is always fully materialized, never a sparse diff.** Selecting a
   preset copies all eight fields into the card; editing one field edits that field only,
   in place. `based_on: <preset_id>` is retained solely so the UI can label the card
   ("Fairy-Tale/Fable (modified)") and offer a reset — it plays no role in prompt
   rendering, which only ever reads the materialized fields. A sparse diff was rejected
   because it would need the shared preset definition to resolve unset fields at render
   time, and editing that shared definition later would silently change the voice of every
   story already using it mid-telling. Naming: `"{preset display name} (modified)"` until
   the author renames it.

5. **Tone modulates within the voice; it never edits the voice.** The five identity
   fields (`person`, `tense`, `narrative_distance`, `register`, `sentence_rhythm`) are
   near-invariant for the whole telling. A Scene Card's `tone` governs which items from
   `imagery_palette` get pulled forward and where emphasis falls — demonstrated in the
   prototype by rendering the same Fairy-Tale/Fable card against two different tones
   (`wistful, quietly bleak` vs. a hypothetical `triumphant, dazzled`) and showing the
   imagery shift (ash/cinders vs. gold/candlelight) while register and rhythm held. This
   is why tone is rendered as a separate block in the template above rather than merged
   into the Voice Card fields.

## Consequences

- Feeds the writer prompt contract (issue #16) the rendering template directly.
- Does not itself unblock issue #16 — that ticket also still waits on the zoom-level
  context assembler (issue #12).
- Leaves a validation gap, not a new open question: `dialogue_density` and any effect from
  varying `person`/`tense` need a second prototype pass against a dialogue-heavy scene
  before the field set can be called fully proven. Whoever builds the writer prompt
  contract should watch for either field failing to move the prose in practice.
- A drift-measurement approach for the continuity pass (issue #15) was sketched during
  this ticket but is that ticket's decision to make, not this one's: anchor against
  `style_exemplar` when present (scene 1, nothing generated yet to compare against), then
  from scene 2 on anchor against stats measured from the story's own early generated
  prose (average sentence length, dialogue fraction, which `imagery_palette` domains
  actually surface in the Scene Digest's `imagery_signature`) rather than against the
  card's text description — flag deviation to the continuity pass, never gate the
  read-time run on it.

## Amendment (2026-09-11)

Decision 3's rendering template calls the palette line *"Preferred imagery (draw from these before
inventing new ones)"*. [ADR 0010](0010-repetition-and-voice-drift-control.md) §4 — written after
this one — reinterprets what those entries **are**: "a palette domain is the motif declaration; the
ledger governs only the vehicle within it." The template never carried that word into the prompt,
and the first live run of a fixture showed the cost (issue #62): the writer read the entries as
stock phrases and lifted them into the prose verbatim, producing lines like *"shaking a shift like
a wet flag pulled from laundry on a line of pure grievance"*, and tagged its `imagery_signature`
entries with `image === domain`, which makes ADR 0010's whole tag-equality mechanism degenerate.

The line now names them as domains and says what to do with them:

```
- Imagery domains (draw fresh images from within these before inventing new ones; they are
  domains to draw from, never phrases to reuse verbatim): {imagery_palette}
```

This is ADR 0010's decision reaching back into this ADR's template, not a new one. Nothing else in
decision 3 changes, and decision 5's separation of `tone` from the voice is untouched.
