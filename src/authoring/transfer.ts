/**
 * Import and export a Story Package as JSON — ADR 0017 §6's escape hatch.
 *
 * It is the reason the forms in #88 and #89 are allowed to stay deliberately narrow: an authoring
 * gap is never a dead end, because the whole package is always reachable as the same JSON the
 * fixtures are written in. It costs almost nothing, and it round-trips.
 *
 * Two rules the module exists to keep:
 *
 * - **Import writes to the Manuscript**, never to a retained version. A second path to a
 *   published package would be a path around the publish gate, which is the one thing ADR 0017 §3
 *   is built to be.
 * - **Nothing unrecognized is dropped.** `StoryPackageSchema` is a loose object precisely so a
 *   package can carry blocks the schema has never heard of — both long fixtures carry an
 *   `_authoring_conventions` block — and an import that quietly discarded them would make export
 *   a lossy operation on the author's own work.
 */

import { lintPackage, type LintResult } from './lint';
import { DraftStoryPackageSchema, type DraftStoryPackage } from '../schema/manuscript';

/**
 * A package as JSON, in exactly the shape the store writes.
 *
 * Two spaces and a trailing newline, matching `StoryRepository`'s own serializer and the fixture
 * files on disk — so an exported package is diffable against a fixture, and a package exported
 * from a retained version is byte-for-byte what the store holds.
 */
export function serializePackage(pkg: unknown): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** What an exported file is called: recognizable, and sorted next to its story. */
export function exportFilename(storyId: string, version: number | null): string {
  const suffix = version === null ? 'draft' : `v${version}`;
  return `${storyId}.${suffix}.package.json`;
}

export interface ImportSummary {
  readonly story_id: string;
  readonly title: string;
  readonly package_version: number;
  readonly scenes: number;
  readonly entities: number;
  /** Top-level blocks the schema does not name — carried through, and worth saying so. */
  readonly extra_blocks: string[];
}

const KNOWN_BLOCKS = new Set([
  'schema_version',
  'package_version',
  'story_id',
  'world_model_seed',
  'scene_cards',
  'voice_card',
  'metadata',
]);

export function importSummary(pkg: DraftStoryPackage): ImportSummary {
  const seed = pkg.world_model_seed;
  return {
    story_id: pkg.story_id,
    title: pkg.metadata.title,
    package_version: pkg.package_version,
    scenes: pkg.scene_cards.length,
    entities:
      (seed.characters?.length ?? 0) + (seed.locations?.length ?? 0) + (seed.objects?.length ?? 0),
    extra_blocks: Object.keys(pkg).filter((key) => !KNOWN_BLOCKS.has(key)),
  };
}

export type ImportRejection = 'not_json' | 'not_an_object' | 'not_a_package';

export type ImportResult =
  | {
      readonly ok: true;
      readonly package: DraftStoryPackage;
      /** Run before anything is saved, so the author sees the problems first. */
      readonly lint: LintResult;
      readonly summary: ImportSummary;
    }
  | { readonly ok: false; readonly reason: ImportRejection; readonly message: string };

/**
 * Read pasted or uploaded text as a package.
 *
 * Parsed **loosely**, against the Manuscript's relaxed schema rather than the strict one, and this
 * is the deliberate part: a package with a malformed scene is accepted and its problems reported,
 * because a half-broken import the author can then fix in the editor is more useful than a
 * rejection that leaves them with a text file and no way in. The strict parse still happens, at
 * exactly one moment — publish (ADR 0017 §2).
 *
 * Refusal is reserved for text that is not a package at all, where there is nothing to fix.
 */
export function parseImport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: 'not_json',
      message: error instanceof Error ? `not JSON: ${error.message}` : 'not JSON',
    };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      reason: 'not_an_object',
      message: 'a Story Package is a JSON object, and this is not one',
    };
  }

  const parsed = DraftStoryPackageSchema.safeParse(raw);
  if (!parsed.success) {
    // Even the relaxed schema said no, which means the shape is wrong rather than the content
    // incomplete — `scene_cards` is not an array, say. There is nothing here to fix in a form.
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: 'not_a_package',
      message:
        first === undefined
          ? 'this does not look like a Story Package'
          : `this does not look like a Story Package: ${first.path.join('.')} ${first.message}`,
    };
  }

  return {
    ok: true,
    package: parsed.data,
    lint: lintPackage(parsed.data),
    summary: importSummary(parsed.data),
  };
}

/**
 * The package as it will be stored under `storyId`.
 *
 * The `story_id` in the file is the exporting story's, and honouring it would let an import
 * rename the story it landed in — or worse, land under an id that is already somebody else's.
 * The target always wins; the file's id is reported to the author, not applied.
 */
export function adoptStoryId(pkg: DraftStoryPackage, storyId: string): DraftStoryPackage {
  return pkg.story_id === storyId ? pkg : { ...pkg, story_id: storyId };
}
