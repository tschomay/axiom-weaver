/**
 * Loading a Story Package end to end: read → parse → World Model → cross-reference check →
 * persist.
 *
 * The cross-reference pass itself is `./cross-reference`; this module is the file-reading half,
 * and is the only one of the two that touches a filesystem.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseStoryPackage, type StoryPackage } from '../schema/story-package';
import type { StoryRepository } from '../persistence/story-repository';
import { loadStory, type LoadedStory } from './cross-reference';

// Re-exported so every existing import of the cross-reference pass keeps working. The pass itself
// lives in `./cross-reference`, which reaches no filesystem — this module does, and a browser
// bundle that pulled the linter in would otherwise pull `node:fs` in behind it.
export {
  loadStory,
  sceneCardCrossReferences,
  sceneCardProblems,
  type CrossReferenceProblem,
  type LoadedStory,
} from './cross-reference';

export const FIXTURE_STORY_IDS = [
  'cinderella',
  'a-christmas-carol',
  // Three original short packages (3-5 scenes). The two public-domain fixtures are the scale
  // test; these are the iteration loop — short enough that a whole live telling costs a handful
  // of writer requests rather than a day's allowance (AGENTS.md, The Gemini API key).
  'the-amber-cat',
  'the-dragon-of-thistlewick',
  'the-lamp-at-cairn-head',
] as const;
export type FixtureStoryId = (typeof FIXTURE_STORY_IDS)[number];

export function fixturePath(fixture: string, root = process.cwd()): string {
  return join(root, 'fixtures', fixture, 'package.json');
}

/** Read and parse a fixture Story Package. Throws a `ZodError` on a schema mismatch. */
export async function readFixturePackage(
  fixture: string,
  root = process.cwd(),
): Promise<StoryPackage> {
  const body = await readFile(fixturePath(fixture, root), 'utf8');
  return parseStoryPackage(JSON.parse(body));
}

/**
 * One cross-reference problem, located at the package field that owns it.
 *
 * The `path` is the load-bearing half — ADR 0017 §4 makes it what lets the authoring screen put
 * the author on the offending field, and a problem an author cannot navigate to is a problem they
 * will not fix. `sceneCardProblems` below renders the same data as the flat strings the fixture
 * loader has always printed.
 */
export async function loadFixtureStory(
  fixture: string,
  root = process.cwd(),
): Promise<LoadedStory> {
  return loadStory(await readFixturePackage(fixture, root));
}

/** Load a fixture and retain its `package_version` snapshot in the repository. */
export async function loadFixtureIntoRepository(
  fixture: string,
  repository: StoryRepository,
  root = process.cwd(),
): Promise<LoadedStory> {
  const loaded = await loadFixtureStory(fixture, root);
  if (loaded.problems.length > 0) {
    throw new Error(
      `Fixture "${fixture}" does not cross-reference cleanly:\n  ${loaded.problems.join('\n  ')}`,
    );
  }
  await repository.putPackage(loaded.pkg);
  return loaded;
}
