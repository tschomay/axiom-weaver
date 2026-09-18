/**
 * The Arc Brief — the input surface of the original-arc generator (issue #119).
 *
 * This is the "premise / genre / length target" the ticket asks for, with each of those three
 * words replaced by something that names a single layer.
 *
 * **`plot_shape`, never `genre`.** "Genre" means two unrelated things in this repo and only one
 * of them is Fabula. Genre-as-prose-style is the Voice Card's job — ADR 0007's five style presets
 * live at the Performance layer and are not this module's business. Genre-as-*plot shape* — a
 * mystery's event structure versus a courtship's — is Fabula, and is what an arc generator needs.
 * Taking one `genre` string and letting it mean both is exactly the layer confusion `CONTEXT.md`
 * warns against, so the field here is called `plot_shape` and there is no field called `genre`.
 *
 * **Length is `event_count`, never words.** Words are `length_budget`, a per-Scene-Card
 * Performance concern (ADR 0006). At the Fabula layer length is a count of events, which becomes
 * a scene count downstream once #118's segmentation merges. See `EVENT_COUNT_BAND` for the
 * calibration against the two fixtures.
 *
 * **Every preset materializes.** ADR 0007 decision 4 settled this for Voice Cards and recorded
 * why: an edited field lives in the card itself, never as a diff against a shared preset, so
 * editing a preset later cannot silently change a story already told in it. The same rule holds
 * here. `materializeBrief` expands a preset id into fully-populated, editable rows — phases, cast
 * roles, obligatory moves — and the generator reads only those materialized fields. `based_on`
 * survives purely as a provenance label, exactly as ADR 0007 keeps it for the UI's benefit, and
 * plays no part in prompting.
 */

/** One phase of a plot shape: an editable row, not a label the generator reinterprets. */
export interface PlotPhase {
  readonly name: string;
  /** What this stretch of the arc is *for*, in the generator's own terms. */
  readonly purpose: string;
  /** Roughly what fraction of the events belong to it. Weights, normalized at render time. */
  readonly share: number;
}

/** A structural role the cast has to fill for the shape to be that shape. */
export interface CastRole {
  readonly role: string;
  readonly purpose: string;
}

/**
 * A plot shape, fully materialized.
 *
 * `id` is provenance only (ADR 0007 decision 4's `based_on`), never resolved back into a shared
 * definition at generation time.
 */
export interface PlotShape {
  readonly id: string;
  readonly name: string;
  /** The question the shape exists to answer, one line. */
  readonly central_question: string;
  readonly phases: PlotPhase[];
  readonly cast_roles: CastRole[];
  /** Structural obligations the shape imposes — the things that make it this shape and not another. */
  readonly obligatory_moves: string[];
}

/**
 * A premise, in the two forms the prototype A/Bs.
 *
 * The research (`docs/research/llm-arc-generation-prior-art.md` §2) says diversity is won at the
 * seed and not at the decoding temperature, and that MoPS's typed-module sampling beat free text.
 * That is a claim about *our* pipeline that we can measure rather than inherit, so both arms are
 * representable here: `modules === null` is the free-text arm, carrying only a logline.
 */
export interface PremiseModules {
  readonly theme: string;
  readonly setting_time: string;
  readonly setting_place: string;
  readonly protagonist: string;
  readonly protagonist_want: string;
  readonly antagonism: string;
  readonly complication: string;
  readonly ending_shape: string;
}

export interface Premise {
  readonly logline: string;
  readonly modules: PremiseModules | null;
}

/**
 * The plant/payoff density dial, materialized.
 *
 * Mirrors ADR 0006 decision 5's `tight`/`normal`/`loose` `required_beats` presets — same three
 * names, same "sugar over a number" shape — but the number here is edge count and span, because
 * that is what §4.1's plant-span histogram measures.
 *
 * `min_span` and `long_range_edges` are *generation-time guidance*, not gates. Enforcing a span
 * floor mechanically would be scoring our own homework: the histogram exists to show whether the
 * arc reaches across itself, and a validator that rejected short spans would guarantee the number
 * without changing the arc's character. They are stated in the prompt and measured afterwards.
 */
/** The three density presets, in the order a picker should offer them. */
export const PLANT_DENSITIES: readonly ['tight', 'normal', 'loose'] = ['tight', 'normal', 'loose'];

export interface PlantPolicy {
  readonly density: (typeof PLANT_DENSITIES)[number];
  readonly target_edges: number;
  /** Fewest events a plant should sit ahead of its payoff. Guidance. */
  readonly min_span: number;
  /** How many of the edges should reach at least `long_range_span`. Guidance. */
  readonly long_range_edges: number;
  readonly long_range_span: number;
}

export interface CastScale {
  readonly characters: number;
  readonly locations: number;
  readonly objects: number;
}

export interface ArcBrief {
  readonly story_id: string;
  readonly title: string;
  readonly premise: Premise;
  readonly plot_shape: PlotShape;
  readonly event_count: number;
  readonly cast: CastScale;
  readonly plant_policy: PlantPolicy;
  /**
   * Whether the plant-span guidance is shown to the model at all.
   *
   * The A/B arm for the failure mode `llm-arc-generation-prior-art.md` §6 accepts as the cost of
   * interleaving: the mechanically valid, dramatically inert arc with every plant one event ahead
   * of its payoff. Turning this off and re-measuring the histogram is the only honest way to tell
   * whether the guidance is doing anything.
   */
  readonly span_guidance: boolean;
  /** Provenance labels. Read by a report, never by the generator. */
  readonly based_on: { plot_shape_preset: string | null; premise_preset: string | null };
}

/**
 * The event-count band, calibrated against the two fixtures.
 *
 * `fixtures/cinderella` is 14 Scene Cards and `fixtures/a-christmas-carol` is 20, and
 * `fixtures/authoring-notes.md` records that the *Carol* was merged down to those 20 from ~28
 * finest-grain beats — a Fabula-to-Syuzhet ratio of about 1.4. So a Fabula event list aiming at
 * the fixtures' scene band wants roughly 18–28 events, and a generated arc below about 12 events
 * cannot carry a plant/payoff graph with any span in it at all.
 */
export const EVENT_COUNT_BAND = { min: 12, max: 28, default: 20 } as const;

/** The observed Fabula-event-to-Scene-Card ratio in the one fixture that documents its merge. */
export const EVENTS_PER_SCENE = 1.4;

/** Event count for a target Scene Card count, using the *Carol*'s own documented merge ratio. */
export function eventCountForSceneTarget(scenes: number): number {
  const raw = Math.round(scenes * EVENTS_PER_SCENE);
  return Math.min(EVENT_COUNT_BAND.max, Math.max(EVENT_COUNT_BAND.min, raw));
}

/**
 * Edge and span targets for a density and a length.
 *
 * The rates are anchored on what the human-authored fixtures actually do, which is far sparser
 * than a naive reading of "plant/payoff density" suggests: Cinderella declares 2 `pays_off` edges
 * across 14 scenes and the *Carol* 3 across 20 — about 0.15 edges per scene, with spans of
 * 5 and 2, and 7 and 8. `loose` is therefore set at the fixtures' own rate, and `tight` at a
 * little over double it; nothing here proposes that a denser graph is a better one.
 */
export function plantPolicyFor(
  density: PlantPolicy['density'],
  eventCount: number,
): PlantPolicy {
  const rate = density === 'tight' ? 0.3 : density === 'normal' ? 0.2 : 0.14;
  const targetEdges = Math.max(2, Math.round(eventCount * rate));
  const longRangeSpan = Math.max(4, Math.floor(eventCount / 2));
  return {
    density,
    target_edges: targetEdges,
    min_span: 3,
    long_range_edges: Math.max(1, Math.floor(targetEdges / 2)),
    long_range_span: longRangeSpan,
  };
}

// --- Plot-shape presets -------------------------------------------------------------------
//
// Five shapes, chosen so that no two of them share a phase structure — the point of the
// parameter is that a mystery and a courtship differ in their *event* structure, and a preset
// list whose entries all resolve to "setup / complication / resolution" would be a label after
// all. Each is written as the rows it expands into, which is what `materializePlotShape` hands
// back verbatim.

const PLOT_SHAPE_PRESETS: readonly PlotShape[] = [
  {
    id: 'mystery',
    name: 'Mystery',
    central_question: 'What actually happened, and who is willing to say so?',
    phases: [
      { name: 'Disturbance', purpose: 'A wrong surfaces and someone is obliged to look into it.', share: 0.2 },
      { name: 'Inquiry', purpose: 'Evidence accumulates, most of it true and misread.', share: 0.35 },
      { name: 'Wrong turn', purpose: 'A reading of the evidence that is coherent and wrong collapses.', share: 0.2 },
      { name: 'Solution', purpose: 'The true account, assembled only from what the reader has already been shown.', share: 0.15 },
      { name: 'Cost', purpose: 'What knowing costs the person who found out.', share: 0.1 },
    ],
    cast_roles: [
      { role: 'investigator', purpose: 'Carries the reader through the inquiry and pays its cost.' },
      { role: 'concealer', purpose: 'Has a reason to keep the true account from being assembled.' },
      { role: 'witness', purpose: 'Holds one true piece and misunderstands its meaning.' },
      { role: 'wronged party', purpose: 'The reason the question matters at all.' },
    ],
    obligatory_moves: [
      'Every element of the true account is on the page before it is stated.',
      'At least one true detail is shown early in a context that makes it look irrelevant.',
      'The wrong reading is defensible on the evidence available when it is made.',
    ],
  },
  {
    id: 'transformation',
    name: 'Transformation',
    central_question: 'Can this person become someone else, and what has to be shown to them first?',
    phases: [
      { name: 'The settled self', purpose: 'The protagonist at their most characteristic, and what it costs others.', share: 0.2 },
      { name: 'Summons', purpose: 'Something forces a confrontation the protagonist cannot argue with.', share: 0.15 },
      { name: 'Shown', purpose: 'A sequence of confrontations, each harder to dismiss than the last.', share: 0.35 },
      { name: 'Refusal and collapse', purpose: 'The last defence of the old self fails.', share: 0.15 },
      { name: 'The altered self', purpose: 'The change tested against the situation from the opening.', share: 0.15 },
    ],
    cast_roles: [
      { role: 'the unchanged', purpose: 'The protagonist, defined by a habit the story will break.' },
      { role: 'summoner', purpose: 'Compels the confrontation; need not be sympathetic.' },
      { role: 'the harmed', purpose: 'Bears the cost of the old self, visibly, from the first phase.' },
      { role: 'the witness', purpose: 'Notices the change before the protagonist claims it.' },
    ],
    obligatory_moves: [
      'The opening establishes the exact behaviour the ending will contradict.',
      'At least one confrontation shows the protagonist a consequence they caused and never saw.',
      'The final phase revisits a specific person or place from the first phase.',
    ],
  },
  {
    id: 'quest',
    name: 'Quest',
    central_question: 'What does the journey turn out to have been for?',
    phases: [
      { name: 'Lack', purpose: 'Something is missing, and the protagonist is the one who must go.', share: 0.15 },
      { name: 'Departure', purpose: 'Leaving costs something that will be missed later.', share: 0.15 },
      { name: 'Trials', purpose: 'Obstacles that each take something and each teach something.', share: 0.35 },
      { name: 'The object', purpose: 'The thing is reached, and is not what it was thought to be.', share: 0.2 },
      { name: 'Return', purpose: 'Home, altered, judged against the lack that started it.', share: 0.15 },
    ],
    cast_roles: [
      { role: 'seeker', purpose: 'Goes, and is changed by going.' },
      { role: 'giver', purpose: 'Hands over the means, with a condition attached.' },
      { role: 'obstructor', purpose: 'Wants the object, or wants the seeker not to have it.' },
      { role: 'the left behind', purpose: 'Makes the return mean something.' },
    ],
    obligatory_moves: [
      'The means handed over early carries a limit that matters at the object.',
      'At least one trial is lost, not won.',
      'The return scene is set in the place the departure scene left.',
    ],
  },
  {
    id: 'courtship',
    name: 'Courtship',
    central_question: 'What has to be given up for these two to be honest with each other?',
    phases: [
      { name: 'Two worlds', purpose: 'Both parties established separately, each with a commitment in the way.', share: 0.2 },
      { name: 'Collision', purpose: 'Forced proximity; a misjudgement each makes about the other.', share: 0.2 },
      { name: 'Concealment', purpose: 'Something true is withheld, for a reason that is not cowardice.', share: 0.25 },
      { name: 'Exposure', purpose: 'The withheld thing surfaces at the worst available moment.', share: 0.2 },
      { name: 'Terms', purpose: 'What each actually gives up, stated plainly.', share: 0.15 },
    ],
    cast_roles: [
      { role: 'first party', purpose: 'Withholds something, and has a good reason.' },
      { role: 'second party', purpose: 'Misjudges the first, on evidence.' },
      { role: 'obligation', purpose: 'A person embodying what one of them owes elsewhere.' },
      { role: 'confidant', purpose: 'Knows the withheld thing and is bound not to say it.' },
    ],
    obligatory_moves: [
      'The reader learns the withheld thing before the second party does.',
      'The misjudgement is reasonable given what that character has been shown.',
      'Neither party gets what they wanted without naming what it costs.',
    ],
  },
  {
    id: 'reckoning',
    name: 'Reckoning',
    central_question: 'Does the debt get collected, and does collecting it help?',
    phases: [
      { name: 'The injury', purpose: 'The original wrong, shown rather than reported.', share: 0.15 },
      { name: 'The vow', purpose: 'A commitment made in a state the maker will not always be in.', share: 0.15 },
      { name: 'Preparation', purpose: 'Means acquired, allies made and used, a self narrowed to a purpose.', share: 0.3 },
      { name: 'Contact', purpose: 'The wrongdoer, close enough to be seen as a person.', share: 0.25 },
      { name: 'Aftermath', purpose: 'What is left of the avenger once the purpose is gone.', share: 0.15 },
    ],
    cast_roles: [
      { role: 'claimant', purpose: 'Holds the debt and is deformed by holding it.' },
      { role: 'debtor', purpose: 'Committed the wrong, and has a life that does not look like a villain\'s.' },
      { role: 'enabler', purpose: 'Helps the claimant for reasons of their own.' },
      { role: 'the restraint', purpose: 'Argues for the cost, and is not simply right.' },
    ],
    obligatory_moves: [
      'The vow is made with a specific, quotable condition attached.',
      'The debtor is shown doing something that is not villainous before contact.',
      'The aftermath addresses the vow\'s exact wording.',
    ],
  },
];

export const PLOT_SHAPE_IDS: readonly string[] = PLOT_SHAPE_PRESETS.map((shape) => shape.id);

/**
 * Expand a plot-shape preset into the rows an author can then edit.
 *
 * Deep-copied on the way out, for the reason ADR 0007 gives: what comes back belongs to this
 * brief, and editing it must never reach back into the shared definition.
 */
export function materializePlotShape(id: string): PlotShape {
  const preset = PLOT_SHAPE_PRESETS.find((shape) => shape.id === id);
  if (preset === undefined) {
    throw new Error(`unknown plot shape "${id}" — one of ${PLOT_SHAPE_IDS.join(', ')}`);
  }
  return {
    id: preset.id,
    name: preset.name,
    central_question: preset.central_question,
    phases: preset.phases.map((phase) => ({ ...phase })),
    cast_roles: preset.cast_roles.map((role) => ({ ...role })),
    obligatory_moves: [...preset.obligatory_moves],
  };
}

export interface BriefInput {
  readonly story_id: string;
  readonly title: string;
  readonly premise: Premise;
  readonly plot_shape_preset: string;
  /** Overrides applied *on top of* the materialized shape, in place — never stored as a diff. */
  readonly plot_shape_overrides?: Partial<Omit<PlotShape, 'id'>>;
  readonly event_count?: number;
  readonly cast?: Partial<CastScale>;
  readonly plant_density?: PlantPolicy['density'];
  readonly span_guidance?: boolean;
  readonly premise_preset?: string | null;
}

/** Turn preset ids and overrides into the fully-expanded brief the generator actually reads. */
export function materializeBrief(input: BriefInput): ArcBrief {
  const eventCount = Math.min(
    EVENT_COUNT_BAND.max,
    Math.max(EVENT_COUNT_BAND.min, input.event_count ?? EVENT_COUNT_BAND.default),
  );
  const shape = materializePlotShape(input.plot_shape_preset);
  const density = input.plant_density ?? 'normal';

  return {
    story_id: input.story_id,
    title: input.title,
    premise: input.premise,
    plot_shape: { ...shape, ...input.plot_shape_overrides },
    event_count: eventCount,
    cast: {
      characters: input.cast?.characters ?? Math.max(4, Math.round(eventCount / 3)),
      locations: input.cast?.locations ?? Math.max(3, Math.round(eventCount / 4)),
      objects: input.cast?.objects ?? Math.max(2, Math.round(eventCount / 5)),
    },
    plant_policy: plantPolicyFor(density, eventCount),
    span_guidance: input.span_guidance ?? true,
    based_on: {
      plot_shape_preset: input.plot_shape_preset,
      premise_preset: input.premise_preset ?? null,
    },
  };
}
