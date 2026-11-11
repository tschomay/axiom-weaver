/**
 * The answer key: the fixture package, plus the hand-built Fabula ordering over it.
 *
 * `docs/agents/story-authoring-eval.md` §2 names `fixtures/cinderella/package.json` and
 * `fixtures/a-christmas-carol/package.json` as the extraction answer key, and §3.3 asks for
 * event recall "against a hand-built event list for the source: ≥ 0.85 of events the fixture's
 * Scene Cards' `required_beats` collectively entail". That sentence is read literally here: the
 * ground-truth event list *is* the flattened `required_beats`, in fixture scene order, and each
 * beat inherits its scene's Fabula rank from `fixtures/extraction/chronology.json`.
 *
 * §2's warning is the reason nothing else is derived from the fixture. The fixtures are one valid
 * authoring, and every metric below is built to be granularity-tolerant — so a beat is matched by
 * *entailment* (judged), never by string overlap, and a candidate event with no matching beat is
 * not automatically an error, only a candidate for the fabrication check.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseStoryPackage, scenesInOrder, type StoryPackage } from '../../schema/story-package';

export type Confidence = 'high' | 'low';

export interface GroundTruthEvent {
  readonly id: string;
  readonly scene_id: string;
  readonly text: string;
  /** Position in the order the source narrates. */
  readonly narrated_key: number;
  /** Position on the story's own timeline. */
  readonly chronological_key: number;
  readonly confidence: Confidence;
  /**
   * Whether the beat is something the extractor is *allowed* to produce (#165). False for a beat
   * `fixtures/<story>/beats.annotation.json` records as a standing fact, a description, a mood or
   * a non-action. True for every other beat, including every beat of a fixture with no sidecar.
   */
  readonly eventful: boolean;
}

export type NonEventKind =
  | 'standing_fact'
  | 'characterisation'
  | 'description'
  | 'mood'
  | 'expectation'
  | 'non_action'
  | 'negative_state';

const NON_EVENT_KINDS: readonly NonEventKind[] = [
  'standing_fact',
  'characterisation',
  'description',
  'mood',
  'expectation',
  'non_action',
  'negative_state',
];

/**
 * A `required_beat` that is not an event by the extractor's own definition (#165).
 *
 * §3.4 scores event recall against the flattened `required_beats`, and `pass-events.ts` defines an
 * event as "one thing that HAPPENS or CHANGES… Not a description, not a mood, not a standing
 * fact." Some beats are exactly those things, so the denominator held items the pipeline is
 * forbidden to produce: on Cinderella a perfect extraction scored 45/53 = 0.849 against a 0.85
 * bar. This is the same error #151 fixed for the world-model tables.
 *
 * The classification is a sidecar for the reason `PlantAnnotation` is one: the rubric has no
 * authority to change the package. It lists only the beats taken *out*, each with its reason, so
 * the exclusion can be argued with line by line; a beat it does not name is eventful.
 */
export interface NonEventfulBeat {
  /** `<scene_id>#<index into required_beats>` — the same id `GroundTruthEvent` carries. */
  readonly beat_id: string;
  /** The beat's text, copied. Checked against the package so an edited beat cannot stay excluded. */
  readonly text: string;
  readonly kind: NonEventKind;
  readonly confidence: Confidence;
  readonly why: string;
}

export interface BeatAnnotation {
  readonly story_id: string;
  readonly non_eventful: readonly NonEventfulBeat[];
}

/**
 * A plant/payoff pair a reader would name, recorded outside the package (#153).
 *
 * §3.7 scores plant/payoff recall against the fixture's *declared* `pays_off` graph, and that
 * graph is tiny — 2, 3 and 5 edges across the three fixtures. At that denominator the metric
 * cannot distinguish "segmentation does not recover plants" from "the fixture declared three of
 * the thirty pairs a reader would name, and the candidate found four different ones."
 *
 * The fix is a sidecar rather than new `pays_off` edges, following the precedent §3.2 set for
 * spans: "a sidecar keyed by `fact_ref` and scene id, not a Scene Card field," because the rubric
 * has no authority to change the schema. The packages stay exactly as authored — their own graphs,
 * their lint status and their publishability are untouched — and ADR 0020 is not relitigated,
 * because recording a pair a reader would name is not adding a trigger term.
 */
export interface PlantAnnotationPair {
  readonly fact_ref: string;
  readonly plant: string | null;
  readonly payoff: string;
  readonly why: string;
}

export interface PlantAnnotation {
  readonly story_id: string;
  /** Pairs the package already declares. Kept for provenance; not re-scored from here. */
  readonly declared: readonly PlantAnnotationPair[];
  /** Pairs the source supports that the package's own graph does not declare. */
  readonly implicit: readonly PlantAnnotationPair[];
  readonly inclusion_rule: unknown;
  readonly provenance: unknown;
}

export interface GroundTruth {
  readonly story_id: string;
  readonly package: StoryPackage;
  readonly package_version: number;
  readonly events: readonly GroundTruthEvent[];
  readonly notes: readonly string[];
  /** Present when `fixtures/<story>/plants.annotation.json` exists. See `PlantAnnotation`. */
  readonly plant_annotation: PlantAnnotation | null;
  /** Present when `fixtures/<story>/beats.annotation.json` exists. See `NonEventfulBeat`. */
  readonly beat_annotation: BeatAnnotation | null;
}

interface ChronologyFile {
  [storyId: string]: { notes?: string[]; scenes?: Array<{ id: string; rank: number; confidence: Confidence }> } | unknown;
}

export async function loadGroundTruth(storyId: string, repoRoot = process.cwd()): Promise<GroundTruth> {
  const packagePath = path.join(repoRoot, 'fixtures', storyId, 'package.json');
  const pkg = parseStoryPackage(JSON.parse(await readFile(packagePath, 'utf8')) as unknown);

  const annotationPath = path.join(repoRoot, 'fixtures', storyId, 'plants.annotation.json');
  let plantAnnotation: PlantAnnotation | null = null;
  try {
    const raw = JSON.parse(await readFile(annotationPath, 'utf8')) as Record<string, unknown>;
    const pairs = (value: unknown): PlantAnnotationPair[] =>
      (Array.isArray(value) ? value : []).map((row) => {
        const entry = row as Record<string, unknown>;
        return {
          fact_ref: String(entry['fact_ref'] ?? ''),
          plant: entry['plant'] === null || entry['plant'] === undefined ? null : String(entry['plant']),
          payoff: String(entry['payoff'] ?? ''),
          why: String(entry['why'] ?? ''),
        };
      });
    plantAnnotation = {
      story_id: storyId,
      declared: pairs(raw['declared_in_package']),
      implicit: pairs(raw['implicit']),
      inclusion_rule: raw['inclusion_rule'] ?? null,
      provenance: raw['provenance'] ?? null,
    };
  } catch {
    // No sidecar for this fixture. §3.7 then scores the declared graph alone and says so.
  }

  const beatAnnotation = await loadBeatAnnotation(storyId, repoRoot);
  const nonEventful = new Map((beatAnnotation?.non_eventful ?? []).map((beat) => [beat.beat_id, beat]));

  const chronologyPath = path.join(repoRoot, 'fixtures', 'extraction', 'chronology.json');
  const chronology = JSON.parse(await readFile(chronologyPath, 'utf8')) as ChronologyFile;
  const entry = chronology[storyId] as
    | { notes?: string[]; scenes?: Array<{ id: string; rank: number; confidence: Confidence }> }
    | undefined;
  if (entry === undefined || entry.scenes === undefined) {
    throw new Error(`fixtures/extraction/chronology.json has no entry for "${storyId}"`);
  }

  const ranks = new Map(entry.scenes.map((scene) => [scene.id, scene]));
  const events: GroundTruthEvent[] = [];

  for (const scene of scenesInOrder(pkg)) {
    const rank = ranks.get(scene.id);
    if (rank === undefined) {
      throw new Error(
        `fixtures/extraction/chronology.json is missing scene "${scene.id}" of "${storyId}" — ` +
          'the ordering ground truth has to cover every fixture scene or the pairwise score is ' +
          'silently computed over a subset.',
      );
    }
    scene.required_beats.forEach((beat, index) => {
      events.push({
        id: `${scene.id}#${index}`,
        scene_id: scene.id,
        text: beat,
        narrated_key: scene.order * 1000 + index,
        chronological_key: rank.rank * 1000 + index,
        confidence: rank.confidence,
        eventful: !nonEventful.has(`${scene.id}#${index}`),
      });
    });
  }

  // A sidecar entry that no longer names a real beat, or names one whose text has since been
  // edited, would silently shrink the denominator by something nobody classified.
  const byId = new Map(events.map((event) => [event.id, event]));
  for (const beat of nonEventful.values()) {
    const event = byId.get(beat.beat_id);
    if (event === undefined || event.text !== beat.text) {
      throw new Error(
        `fixtures/${storyId}/beats.annotation.json excludes "${beat.beat_id}" as a non-event, but ` +
          (event === undefined
            ? 'the fixture has no such beat'
            : 'the beat\'s text no longer matches the fixture\'s') +
          ' — reclassify it rather than leaving a stale exclusion in the recall denominator.',
      );
    }
  }

  return {
    story_id: storyId,
    package: pkg,
    package_version: pkg.package_version,
    events,
    notes: entry.notes ?? [],
    plant_annotation: plantAnnotation,
    beat_annotation: beatAnnotation,
  };
}

async function loadBeatAnnotation(storyId: string, repoRoot: string): Promise<BeatAnnotation | null> {
  let text: string;
  try {
    text = await readFile(path.join(repoRoot, 'fixtures', storyId, 'beats.annotation.json'), 'utf8');
  } catch {
    // No sidecar for this fixture: every beat counts, and `recall_eventful` equals `recall`.
    return null;
  }
  const raw = JSON.parse(text) as Record<string, unknown>;
  const rows = Array.isArray(raw['non_eventful']) ? (raw['non_eventful'] as unknown[]) : [];
  const nonEventful = rows.map((row) => {
    const entry = row as Record<string, unknown>;
    const kind = String(entry['kind'] ?? '') as NonEventKind;
    if (!NON_EVENT_KINDS.includes(kind)) {
      throw new Error(
        `fixtures/${storyId}/beats.annotation.json: "${String(entry['beat_id'])}" has kind ` +
          `"${kind}", which is not one of ${NON_EVENT_KINDS.join(', ')}.`,
      );
    }
    return {
      beat_id: String(entry['beat_id'] ?? ''),
      text: String(entry['text'] ?? ''),
      kind,
      confidence: (entry['confidence'] === 'low' ? 'low' : 'high') as Confidence,
      why: String(entry['why'] ?? ''),
    };
  });
  const ids = nonEventful.map((beat) => beat.beat_id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) {
    throw new Error(`fixtures/${storyId}/beats.annotation.json lists "${repeated}" twice.`);
  }
  return { story_id: storyId, non_eventful: nonEventful };
}

/** Pairs the source narrates in an order other than the one they happen in — §3.3's real test. */
export function narratedOutOfOrder(
  a: GroundTruthEvent,
  b: GroundTruthEvent,
): boolean {
  const narrated = Math.sign(a.narrated_key - b.narrated_key);
  const chronological = Math.sign(a.chronological_key - b.chronological_key);
  return chronological !== 0 && narrated !== chronological;
}
