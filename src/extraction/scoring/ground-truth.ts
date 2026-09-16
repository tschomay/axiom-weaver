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

export interface GroundTruth {
  readonly story_id: string;
  readonly package: StoryPackage;
  readonly package_version: number;
  readonly events: readonly GroundTruthEvent[];
  readonly notes: readonly string[];
}

interface ChronologyFile {
  [storyId: string]: { notes?: string[]; scenes?: Array<{ id: string; rank: number; confidence: Confidence }> } | unknown;
}

export async function loadGroundTruth(storyId: string, repoRoot = process.cwd()): Promise<GroundTruth> {
  const packagePath = path.join(repoRoot, 'fixtures', storyId, 'package.json');
  const pkg = parseStoryPackage(JSON.parse(await readFile(packagePath, 'utf8')) as unknown);

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
