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
      });
    });
  }

  return {
    story_id: storyId,
    package: pkg,
    package_version: pkg.package_version,
    events,
    notes: entry.notes ?? [],
    plant_annotation: plantAnnotation,
  };
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
