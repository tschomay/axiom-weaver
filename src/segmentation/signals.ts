/**
 * What separates two adjacent Fabula events, computed without a model.
 *
 * Issue #118, under the map issue #113. The definition this file encodes is the one the scene
 * segmentation literature converged on (Zehe et al., EACL 2021, quoted verbatim in
 * `docs/research/narrative-extraction-prior-art.md` §3.1): *"a segment of the text where the story
 * time and the discourse time are more or less equal, the narration focuses on one action and
 * space and character constellations stay the same"*. Three of those four clauses — time, space,
 * character constellation — are decidable from the shared `FabulaEvent` fields alone. The fourth,
 * *one action*, is a judgment, and `pass-boundaries.ts` is where a model makes it.
 *
 * Splitting them is not tidiness. §3.3 of the same research says it outright: producing boundaries
 * and producing the scene's dramatic function "are separate difficulties and should be separate
 * passes", and §3.1 records that the BERT-era baseline's failure mode is *gross over-segmentation*
 * (four times as many scenes as the annotation specifies), which is exactly what a purely
 * mechanical rule over these signals does to a fine-grained event list.
 *
 * ## Why none of these is a hard rule
 *
 * The obvious mechanical rule — split whenever `location_id` changes — is wrong, and both fixtures
 * say so. `fixtures/a-christmas-carol/package.json`'s `scene_02_the_haunting_begins` covers
 * Scrooge crossing a yard, a hall, a staircase and his rooms; the extraction run over the same
 * prose names all four as separate locations. `scene_09_the_spirits_tour` goes further and invents
 * `loc_world_tour` for a montage that visits a moor, a lighthouse and a ship. A Scene Card carries
 * exactly one `location_id`, so a merge across locations is not an error — it is the normal case,
 * and the scene's location is *chosen* from the ones its events named.
 *
 * Nor is "same location + same cast ⇒ same scene" sufficient in the other direction.
 * `fixtures/cinderella/package.json` runs four consecutive scenes at `loc_house` with overlapping
 * casts (`scene_01` through `scene_04`), separated by nothing a table can see: time passes, and
 * the action changes. So every signal here is **evidence weighted into a score**, and the score is
 * an input to a judgment rather than a substitute for one.
 *
 * ## What is and is not assumed about the input
 *
 * Only the fields ADR 0019 makes shared are required. `pov`, `dramatic_function` and `caused_by`
 * are read when present — a generated arc (#119) fills them, extraction (#117) does not — and
 * extraction's own additions (`story_time`, `time_anchor`, `narrated_index`) are read the same
 * way, off the event's extra keys, never required. `available` records which signals the input
 * actually supported, so a result never implies evidence that was not there.
 *
 * Nothing here reads source prose, and nothing assumes a correct segmentation exists to be
 * recovered. That is what lets #120 call this on generated input, where there is no source text
 * and no answer key.
 */

import type { FabulaEvent } from '../schema/fabula';

/** Extraction's per-event extras, read defensively — absent on a generated arc. */
export interface EventExtras {
  readonly story_time: string | null;
  readonly time_anchor: string | null;
  readonly narrated_index: number | null;
}

export function extrasOf(event: FabulaEvent): EventExtras {
  const raw = event as unknown as Record<string, unknown>;
  return {
    story_time: typeof raw['story_time'] === 'string' ? raw['story_time'] : null,
    time_anchor: typeof raw['time_anchor'] === 'string' ? raw['time_anchor'] : null,
    narrated_index: typeof raw['narrated_index'] === 'number' ? raw['narrated_index'] : null,
  };
}

/**
 * Which order the scenes are drawn in — and why it is not the order the events arrive in.
 *
 * A Fabula event list is **chronological**. A Scene Card's `order` is **Syuzhet**: the order the
 * story is told in, which is what `reader_must_learn` is relative to, what ADR 0004 means when it
 * requires a plant to precede its payoff, and what `entry_state`/`exit_state` chain along. For a
 * linear story the two coincide and the distinction is invisible. For *A Christmas Carol* — almost
 * entirely flashback and flash-forward — they are wildly different, and segmenting in chronological
 * order produces a package that tells a different story from the one the source tells, with the
 * Stave IV withholding structurally impossible because the reveal has been moved to the end of the
 * timeline rather than the end of the telling.
 *
 * It is also wrong on the segmentation's own terms. Zehe's definition is about a *segment of the
 * text*; a scene is a contiguous stretch of narration. Ordering by chronology cuts the narration
 * into pieces and interleaves them, so the boundary pass is asked to judge continuity between
 * events that were never adjacent on the page.
 *
 * So: **if the input recorded a telling order, use it.** Extraction does, as `narrated_index`.
 * Generation does not — a generated arc has authored no Syuzhet yet — and there the Fabula
 * sequence is the only order there is, which is the honest default rather than an assumption. The
 * basis is reported either way, because a package segmented in one order and a package segmented
 * in the other are different artifacts.
 */
export interface TellingOrder {
  readonly events: readonly FabulaEvent[];
  readonly basis: 'narrated_index' | 'fabula_sequence';
  /** Events whose telling position differs from their chronological position. 0 on a linear story. */
  readonly displaced: number;
}

export function tellingOrder(events: readonly FabulaEvent[]): TellingOrder {
  const indices = events.map((event) => extrasOf(event).narrated_index);
  const usable =
    events.length > 0 &&
    indices.every((index) => index !== null) &&
    new Set(indices).size === events.length;

  if (!usable) {
    return { events: [...events], basis: 'fabula_sequence', displaced: 0 };
  }

  const ordered = [...events].sort(
    (a, b) => (extrasOf(a).narrated_index ?? 0) - (extrasOf(b).narrated_index ?? 0),
  );
  const chronological = new Map(events.map((event, index) => [event.id, index]));
  const displaced = ordered.filter(
    (event, index) => chronological.get(event.id) !== index,
  ).length;
  return { events: ordered, basis: 'narrated_index', displaced };
}

/** Which optional signals the event list actually carried. */
export interface SignalAvailability {
  readonly pov: boolean;
  readonly dramatic_function: boolean;
  readonly caused_by: boolean;
  readonly story_time: boolean;
  readonly narrated_index: boolean;
  readonly location: boolean;
}

export interface Adjacency {
  /** The boundary between `events[index]` and `events[index + 1]`. */
  readonly index: number;
  readonly before_id: string;
  readonly after_id: string;
  /** Both sides named a location, and they differ. */
  readonly location_changed: boolean;
  /** At least one side named no location at all, so space says nothing here. */
  readonly location_unknown: boolean;
  /** |A ∩ B| / |A ∪ B| over `characters_present`. 1 when both casts are empty. */
  readonly cast_overlap: number;
  /** Neither event shares a single character with the other, and both name some. */
  readonly cast_disjoint: boolean;
  /** Both sides named a `pov` and they differ. `null` when the layer did not supply one. */
  readonly pov_changed: boolean | null;
  /** Both sides named a `dramatic_function` and they differ. */
  readonly function_changed: boolean | null;
  /** The later event's `caused_by` names nothing at or before the earlier one. */
  readonly causal_break: boolean | null;
  /** Both sides carried a `story_time` bucket and they differ (a flashback seam). */
  readonly story_time_changed: boolean | null;
  /** How far apart the two events sit in *narrated* order, when the layer recorded it. */
  readonly narration_gap: number | null;
  /** 0 (nothing separates these) to 1 (everything does). Evidence, not a verdict. */
  readonly score: number;
  /** The signals that fired, in the order they are weighted. For a report a human reads. */
  readonly reasons: readonly string[];
}

/**
 * Signal weights.
 *
 * Chosen to rank evidence, not to hit a scene count: the ordering is the claim, and the exact
 * magnitudes only matter relative to each other and to `DEFAULT_BOUNDARY_THRESHOLD`. A disjoint
 * cast outranks a location change because a Scene Card can hold several locations but a scene
 * where nobody from the previous moment is present is a different constellation by Zehe's own
 * definition. A narration gap is weighted lowest because it is the one signal that is an artifact
 * of how the upstream pipeline chunked its reading rather than of the story.
 */
export const SIGNAL_WEIGHTS = {
  cast_disjoint: 0.35,
  cast_churn: 0.2,
  location_changed: 0.25,
  pov_changed: 0.15,
  function_changed: 0.1,
  causal_break: 0.1,
  story_time_changed: 0.25,
  narration_gap: 0.05,
} as const;

/** How far apart in narrated order two events must be before the gap counts as evidence. */
export const NARRATION_GAP_THRESHOLD = 3;

function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const id of left) if (right.has(id)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 1 : shared / union;
}

export function signalAvailability(events: readonly FabulaEvent[]): SignalAvailability {
  const extras = events.map(extrasOf);
  return {
    pov: events.some((event) => event.pov !== undefined),
    dramatic_function: events.some((event) => event.dramatic_function !== undefined),
    caused_by: events.some((event) => event.caused_by.length > 0),
    story_time: extras.some((extra) => extra.story_time !== null),
    narrated_index: extras.some((extra) => extra.narrated_index !== null),
    location: events.some((event) => event.location_id !== null),
  };
}

/**
 * One `Adjacency` per gap between consecutive events. An n-event list has n-1 of them.
 */
export function adjacencies(events: readonly FabulaEvent[]): Adjacency[] {
  const idAt = new Map(events.map((event, index) => [event.id, index]));
  const out: Adjacency[] = [];

  for (let index = 0; index + 1 < events.length; index += 1) {
    const before = events[index]!;
    const after = events[index + 1]!;
    const beforeExtras = extrasOf(before);
    const afterExtras = extrasOf(after);

    const locationUnknown = before.location_id === null || after.location_id === null;
    const locationChanged = !locationUnknown && before.location_id !== after.location_id;

    const overlap = jaccard(before.characters_present, after.characters_present);
    const castDisjoint =
      before.characters_present.length > 0 &&
      after.characters_present.length > 0 &&
      overlap === 0;

    const povChanged =
      before.pov === undefined || after.pov === undefined ? null : before.pov !== after.pov;
    const functionChanged =
      before.dramatic_function === undefined || after.dramatic_function === undefined
        ? null
        : before.dramatic_function !== after.dramatic_function;

    // A causal break only means something when the later event names *any* cause: an arc that
    // never fills `caused_by` would otherwise read as one break per adjacency.
    const causalBreak =
      after.caused_by.length === 0
        ? null
        : !after.caused_by.some((id) => {
            const at = idAt.get(id);
            return at !== undefined && at <= index;
          });

    const storyTimeChanged =
      beforeExtras.story_time === null || afterExtras.story_time === null
        ? null
        : beforeExtras.story_time !== afterExtras.story_time;

    const narrationGap =
      beforeExtras.narrated_index === null || afterExtras.narrated_index === null
        ? null
        : Math.abs(afterExtras.narrated_index - beforeExtras.narrated_index);

    const reasons: string[] = [];
    let score = 0;
    const fire = (weight: number, reason: string): void => {
      score += weight;
      reasons.push(reason);
    };

    if (castDisjoint) fire(SIGNAL_WEIGHTS.cast_disjoint, 'no character carries over');
    else if (overlap < 0.5) fire(SIGNAL_WEIGHTS.cast_churn, 'most of the cast changes');
    if (locationChanged) fire(SIGNAL_WEIGHTS.location_changed, 'the location changes');
    if (povChanged === true) fire(SIGNAL_WEIGHTS.pov_changed, 'the POV changes');
    if (functionChanged === true) {
      fire(SIGNAL_WEIGHTS.function_changed, 'the dramatic function changes');
    }
    if (causalBreak === true) fire(SIGNAL_WEIGHTS.causal_break, 'nothing before this causes it');
    if (storyTimeChanged === true) fire(SIGNAL_WEIGHTS.story_time_changed, 'story time shifts');
    if (narrationGap !== null && narrationGap > NARRATION_GAP_THRESHOLD) {
      fire(SIGNAL_WEIGHTS.narration_gap, `${narrationGap} events of narration in between`);
    }

    out.push({
      index,
      before_id: before.id,
      after_id: after.id,
      location_changed: locationChanged,
      location_unknown: locationUnknown,
      cast_overlap: overlap,
      cast_disjoint: castDisjoint,
      pov_changed: povChanged,
      function_changed: functionChanged,
      causal_break: causalBreak,
      story_time_changed: storyTimeChanged,
      narration_gap: narrationGap,
      score: Math.min(1, score),
      reasons,
    });
  }

  return out;
}
