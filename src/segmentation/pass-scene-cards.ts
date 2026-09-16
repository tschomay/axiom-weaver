/**
 * Pass 2 — what is each scene, now that its boundaries are fixed?
 *
 * `pov`, `location_id`, `dramatic_function`, `required_beats` and a readable id. Deliberately a
 * separate pass from boundary detection, on the research's own advice:
 * `docs/research/narrative-extraction-prior-art.md` §3.3 finds that turning-point identification —
 * the closest published analogue to a Scene Card's dramatic function — *"is only tractable because
 * the scene boundaries are given"*, and concludes that boundaries and function "are separate
 * difficulties and should be separate passes".
 *
 * ## Constrained choice, not free text, wherever a field is an id
 *
 * `pov` and `location_id` are slugs that must resolve against the World Model seed, or the
 * cross-reference pass reports `unknown_entity` and the package cannot publish. So neither is
 * asked for as free text: the model picks from the candidates the scene's own events named, and a
 * pick outside that set is discarded in favour of a counted mechanical fallback. Nothing invents
 * an entity here — segmentation's job is the Syuzhet layer, and the World Model belongs to
 * whichever entry point produced it.
 *
 * `location_id` is a genuine choice rather than a lookup because a scene routinely spans several
 * named places: `fixtures/a-christmas-carol/package.json`'s `scene_02_the_haunting_begins` covers
 * a yard, a hall, a staircase and a room, and its author picked the one the scene is *about*. The
 * candidate list is exactly the places the scene's events named (plus the location carried into
 * it), so the pick is a choice among facts.
 *
 * ## Beats
 *
 * `required_beats` is a compression, not a copy. An extracted event list arrives at a far finer
 * grain than a Scene Card wants — the *Carol* extraction produces 441 events against the fixture's
 * 20 scenes — and pasting every summary in would produce cards nobody can act on and a variance
 * contract with no slack in it. The prompt asks for the beats that must happen, in order, drawn
 * only from what the events say; `docs/agents/story-authoring-eval.md` §3.5 scores invented beats
 * separately from missed ones, and a beat nothing in the events supports is the error that section
 * is watching for.
 *
 * A scene that comes back with no beats falls back to its events' own beats rather than shipping
 * empty: `no_required_beats` is a warning the rubric promotes to a gate (§4.1), and an empty card
 * leaves the whole scene free to vary.
 */

import { z } from 'zod';

import { ExtractionCallError, type ExtractionModel } from '../extraction/call';
import type { FabulaEvent } from '../schema/fabula';
import type { WorldModelSeed } from '../schema/story-package';

/** Scenes per call. Small enough that each one gets real attention inside the response budget. */
export const SCENES_PER_CALL = 4;

const ScenePropertiesSchema = z.object({
  scenes: z
    .array(
      z.object({
        scene_number: z.number().int(),
        label: z.string().default(''),
        pov: z.string().default(''),
        location_id: z.string().default(''),
        dramatic_function: z.string().default(''),
        required_beats: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

const SCENE_SYSTEM = `You are writing SCENE CARDS for scenes whose boundaries are already fixed.

For each scene you are given the story events it contains, in order, and the candidate ids it may
use. Produce:

- "label": two or three lowercase words naming the scene, like "the fitting" or "fezziwigs ball".
- "pov": the character the scene is anchored on — whose scene this is. MUST be one of the
  candidate character ids given for that scene. Copy the id exactly.
- "location_id": where the scene happens. MUST be one of the candidate location ids given for
  that scene. When the scene moves through several, choose the one the scene is ABOUT — a
  character crossing a yard and a hall into a room is a scene in the room.
- "dramatic_function": one sentence saying what this scene is FOR in the story — what it
  establishes, turns, or pays off. Not a summary of what happens; the reason it is here.
- "required_beats": 2 to 6 short imperative-free statements of what must happen, in order.

Hard rules on the beats:
- Every beat must be supported by the events shown. Do NOT add an incident, a motive or a
  consequence the events do not state.
- Compress. Several events usually collapse into one beat. Do not restate each event.
- Do not name a beat the story has not reached yet.`;

function scenePropertiesJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            scene_number: { type: 'integer', description: 'Copied from the item.' },
            label: { type: 'string' },
            pov: { type: 'string' },
            location_id: { type: 'string' },
            dramatic_function: { type: 'string' },
            required_beats: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'scene_number',
            'label',
            'pov',
            'location_id',
            'dramatic_function',
            'required_beats',
          ],
          propertyOrdering: [
            'scene_number',
            'label',
            'pov',
            'location_id',
            'dramatic_function',
            'required_beats',
          ],
        },
      },
    },
    required: ['scenes'],
  };
}

export interface SceneDraft {
  /** 1-based scene order. */
  readonly order: number;
  readonly events: readonly FabulaEvent[];
  /** Characters the scene's events named that the seed knows. */
  readonly candidate_characters: readonly string[];
  /** Locations the scene's events named, plus the one carried into it. */
  readonly candidate_locations: readonly string[];
  /**
   * No event in this scene named a location the seed knows, so the only candidate is one carried
   * forward. Counted, because a "choice" from a single inherited candidate is not a recovered
   * location and a report that does not separate the two overstates what was measured — the same
   * rule ADR 0019 decision 4 applies to the projection's substitutions.
   */
  readonly location_inherited: boolean;
}

export interface SceneProperties {
  readonly order: number;
  readonly id: string;
  readonly pov: string;
  readonly location_id: string;
  readonly dramatic_function: string;
  readonly required_beats: readonly string[];
  readonly pov_from_fallback: boolean;
  readonly location_from_fallback: boolean;
  readonly beats_from_fallback: boolean;
}

export interface ScenePropertiesResult {
  readonly scenes: readonly SceneProperties[];
  readonly failed_batches: number;
  readonly pov_fallbacks: number;
  readonly location_fallbacks: number;
  /** Scenes whose only candidate location was inherited — see `SceneDraft.location_inherited`. */
  readonly location_inherited: number;
  readonly beat_fallbacks: number;
  readonly function_fallbacks: number;
}

/** The location a scene inherits when none of its own events names one. */
export function carriedLocations(
  scenes: ReadonlyArray<readonly FabulaEvent[]>,
  seed: WorldModelSeed,
): string[] {
  const known = new Set(seed.locations.map((row) => row.id));
  const fallback = seed.locations[0]?.id ?? '';
  let last = '';
  return scenes.map((events) => {
    for (const event of events) {
      if (event.location_id !== null && known.has(event.location_id)) last = event.location_id;
    }
    return last === '' ? fallback : last;
  });
}

/** Build the per-scene candidate sets the prompt constrains its answer to. */
export function draftScenes(
  scenes: ReadonlyArray<readonly FabulaEvent[]>,
  seed: WorldModelSeed,
): SceneDraft[] {
  const knownCharacters = new Set(seed.characters.map((row) => row.id));
  const knownLocations = new Set(seed.locations.map((row) => row.id));
  const carried = carriedLocations(scenes, seed);

  return scenes.map((events, index) => {
    const characters: string[] = [];
    const locations: string[] = [];
    for (const event of events) {
      for (const id of event.characters_present) {
        if (knownCharacters.has(id) && !characters.includes(id)) characters.push(id);
      }
      if (
        event.location_id !== null &&
        knownLocations.has(event.location_id) &&
        !locations.includes(event.location_id)
      ) {
        locations.push(event.location_id);
      }
    }
    const inherited = carried[index] ?? '';
    const ownLocations = locations.length > 0;
    if (!ownLocations && inherited !== '') locations.push(inherited);
    return {
      order: index + 1,
      events,
      candidate_characters: characters,
      candidate_locations: locations,
      location_inherited: !ownLocations,
    };
  });
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function sceneId(order: number, label: string): string {
  const padded = String(order).padStart(2, '0');
  const slug = slugify(label);
  return slug === '' ? `scene_${padded}` : `scene_${padded}_${slug}`;
}

function nameOf(seed: WorldModelSeed, id: string): string {
  const row =
    seed.characters.find((entry) => entry.id === id) ??
    seed.locations.find((entry) => entry.id === id);
  return row === undefined ? id : `${id} (${row.name})`;
}

function renderDraft(draft: SceneDraft, seed: WorldModelSeed): string {
  const lines = [
    `SCENE ${draft.order}`,
    `  candidate pov ids: ${
      draft.candidate_characters.length === 0
        ? '(none — leave pov empty)'
        : draft.candidate_characters.map((id) => nameOf(seed, id)).join(', ')
    }`,
    `  candidate location ids: ${
      draft.candidate_locations.length === 0
        ? '(none — leave location_id empty)'
        : draft.candidate_locations.map((id) => nameOf(seed, id)).join(', ')
    }`,
    '  events:',
  ];
  for (const event of draft.events) {
    lines.push(`    - ${event.summary}`);
    for (const beat of event.beats) {
      if (beat !== event.summary) lines.push(`        · ${beat}`);
    }
  }
  return lines.join('\n');
}

export async function describeScenes(
  model: ExtractionModel,
  drafts: readonly SceneDraft[],
  seed: WorldModelSeed,
  options: { batchSize?: number; onProgress?: (message: string) => void } = {},
): Promise<ScenePropertiesResult> {
  const batchSize = options.batchSize ?? SCENES_PER_CALL;
  const progress = options.onProgress ?? ((): void => {});
  const answers = new Map<number, z.infer<typeof ScenePropertiesSchema>['scenes'][number]>();
  const failed: number[] = [];

  for (let start = 0; start < drafts.length; start += batchSize) {
    const batch = drafts.slice(start, start + batchSize);
    progress(`scene properties ${batch[0]!.order}–${batch[batch.length - 1]!.order} of ${drafts.length}`);
    try {
      const response = await model.json(ScenePropertiesSchema, {
        pass: 'segmentation.scene_properties',
        label: `scenes ${batch[0]!.order}–${batch[batch.length - 1]!.order}`,
        systemInstruction: SCENE_SYSTEM,
        contents: batch.map((draft) => renderDraft(draft, seed)).join('\n\n'),
        responseJsonSchema: scenePropertiesJsonSchema(),
        maxOutputTokens: 4096,
      });
      for (const answer of response.scenes) answers.set(answer.scene_number, answer);
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failed.push(start);
    }
  }

  let povFallbacks = 0;
  let locationFallbacks = 0;
  let beatFallbacks = 0;
  let functionFallbacks = 0;

  const scenes = drafts.map((draft): SceneProperties => {
    const answer = answers.get(draft.order);
    const candidateCharacters = new Set(draft.candidate_characters);
    const candidateLocations = new Set(draft.candidate_locations);

    let pov = answer?.pov ?? '';
    let povFallback = false;
    if (pov === '' || !candidateCharacters.has(pov)) {
      pov = draft.candidate_characters[0] ?? '';
      povFallback = true;
      povFallbacks += 1;
    }

    let location = answer?.location_id ?? '';
    let locationFallback = false;
    if (location === '' || !candidateLocations.has(location)) {
      location = draft.candidate_locations[0] ?? '';
      locationFallback = true;
      locationFallbacks += 1;
    }

    const proposed = (answer?.required_beats ?? []).map((beat) => beat.trim()).filter((beat) => beat !== '');
    let beats: string[] = proposed;
    let beatsFallback = false;
    if (beats.length === 0) {
      beats = [...new Set(draft.events.flatMap((event) => event.beats))];
      if (beats.length === 0) beats = draft.events.map((event) => event.summary);
      beatsFallback = true;
      beatFallbacks += 1;
    }

    let dramaticFunction = (answer?.dramatic_function ?? '').trim();
    if (dramaticFunction === '') {
      dramaticFunction = draft.events[0]?.summary ?? 'unspecified';
      functionFallbacks += 1;
    }

    return {
      order: draft.order,
      id: sceneId(draft.order, answer?.label ?? ''),
      pov,
      location_id: location,
      dramatic_function: dramaticFunction,
      required_beats: beats,
      pov_from_fallback: povFallback,
      location_from_fallback: locationFallback,
      beats_from_fallback: beatsFallback,
    };
  });

  return {
    scenes,
    failed_batches: failed.length,
    pov_fallbacks: povFallbacks,
    location_fallbacks: locationFallbacks,
    beat_fallbacks: beatFallbacks,
    function_fallbacks: functionFallbacks,
  };
}
