/**
 * Starting a Manuscript, and publishing one.
 *
 * [ADR 0017](../../docs/adr/0017-the-manuscript-and-publishing.md) §3 and §5. The repository owns
 * storing a Manuscript; this module owns the two acts that give it a shape and an end — seeding
 * it from one of three entry points, and turning it into the next retained `package_version`.
 *
 * Publishing lives here rather than on `StoryRepository` because it is not persistence: it is a
 * strict parse and a lint gate that happen to end in a write. The repository stays a store.
 */

import { lintPackage, type LintResult } from './lint';
import {
  MANUSCRIPT_SCHEMA_VERSION,
  ManuscriptSchema,
  type Manuscript,
  type ManuscriptSource,
} from '../schema/manuscript';
import { parseStoryPackage, type StoryPackage } from '../schema/story-package';
import {
  ManuscriptConflictError,
  type PackagePointer,
  type StoryRepository,
} from '../persistence/story-repository';

const CURRENT_SCHEMA_VERSION = '1.0';

/** A `story_id` slugged from a title: the shape every fixture id already has. */
export function slugifyStoryId(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface NewManuscriptSource {
  readonly source: 'new';
  readonly story_id: string;
  readonly title: string;
}

export interface EditManuscriptSource {
  readonly source: 'edit';
  readonly story_id: string;
}

export interface DuplicateManuscriptSource {
  readonly source: 'duplicate';
  /** The new story's id — checked for collision before anything is written. */
  readonly story_id: string;
  readonly from_story_id: string;
  /** Which retained version to start from. Defaults to the source story's current one. */
  readonly from_version?: number;
  readonly title?: string;
}

export type ManuscriptSeed =
  | NewManuscriptSource
  | EditManuscriptSource
  | DuplicateManuscriptSource;

export class ManuscriptSeedError extends Error {
  readonly reason: 'story_id_taken' | 'story_not_found' | 'version_not_found' | 'invalid_story_id';

  constructor(reason: ManuscriptSeedError['reason'], message: string) {
    super(message);
    this.name = 'ManuscriptSeedError';
    this.reason = reason;
  }
}

/** Whether a `story_id` is free. A story is "taken" once it has a package or a Manuscript. */
export async function storyIdAvailable(
  repository: StoryRepository,
  storyId: string,
): Promise<boolean> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(storyId)) return false;
  if ((await repository.getPointer(storyId)) !== null) return false;
  return (await repository.getManuscript(storyId)) === null;
}

function envelope(storyId: string, title: string): Manuscript['package'] {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    package_version: 1,
    story_id: storyId,
    world_model_seed: {
      characters: [],
      locations: [],
      objects: [],
      relationships: [],
      character_knowledge: [],
    },
    scene_cards: [],
    voice_card: {},
    metadata: { title, created_at: new Date().toISOString() },
  };
}

function wrap(
  storyId: string,
  source: ManuscriptSource,
  basedOn: number | null,
  pkg: Manuscript['package'],
  duplicatedFrom: Manuscript['duplicated_from'] = null,
): Manuscript {
  const now = new Date().toISOString();
  return ManuscriptSchema.parse({
    schema_version: MANUSCRIPT_SCHEMA_VERSION,
    story_id: storyId,
    based_on_version: basedOn,
    source,
    duplicated_from: duplicatedFrom,
    created_at: now,
    updated_at: now,
    package: pkg,
  });
}

/**
 * Seed a Manuscript from one of ADR 0017 §5's three entry points, and store it.
 *
 * **Duplicate** is the one that carries weight: it reads any retained version of any story and
 * carries *only the package* under a new `story_id` — no Working Draft, no Compiled editions, no
 * runs, no Baked pointer. Entity ids keep their slugs, which are story-scoped, so
 * `char_cinderella` under two stories is two rows and not a collision. That is what makes the
 * five fixtures usable as templates, which is the nearest thing to the map's "templates" fog item
 * that does not require building a template system.
 */
export async function seedManuscript(
  repository: StoryRepository,
  seed: ManuscriptSeed,
): Promise<Manuscript> {
  if (seed.source === 'edit') {
    const existing = await repository.getManuscript(seed.story_id);
    if (existing !== null) return existing;

    const pointer = await repository.getPointer(seed.story_id);
    const pkg = await repository.getCurrentPackage(seed.story_id);
    if (pointer === null || pkg === null) {
      throw new ManuscriptSeedError('story_not_found', `no story "${seed.story_id}" to edit`);
    }
    return repository.putManuscript(
      wrap(seed.story_id, 'edit', pointer.current_package_version, pkg),
      null,
    );
  }

  if (!(await storyIdAvailable(repository, seed.story_id))) {
    const reason = /^[a-z0-9][a-z0-9-]*$/.test(seed.story_id)
      ? 'story_id_taken'
      : 'invalid_story_id';
    throw new ManuscriptSeedError(
      reason,
      reason === 'story_id_taken'
        ? `"${seed.story_id}" is already a story`
        : `"${seed.story_id}" is not a usable story id — lowercase letters, digits and hyphens`,
    );
  }

  if (seed.source === 'new') {
    return repository.putManuscript(
      wrap(seed.story_id, 'new', null, envelope(seed.story_id, seed.title)),
      null,
    );
  }

  const fromPointer = await repository.getPointer(seed.from_story_id);
  if (fromPointer === null) {
    throw new ManuscriptSeedError(
      'story_not_found',
      `no story "${seed.from_story_id}" to duplicate`,
    );
  }
  const version = seed.from_version ?? fromPointer.current_package_version;
  const source = await repository.getPackageVersion(seed.from_story_id, version);
  if (source === null) {
    throw new ManuscriptSeedError(
      'version_not_found',
      `"${seed.from_story_id}" has no retained package_version ${version}`,
    );
  }

  // `package_version` restarts at 1 and `based_on_version` stays null: the copy has published
  // nothing, and inheriting the source's version number would claim a history it does not have.
  const copy = {
    ...source,
    package_version: 1,
    story_id: seed.story_id,
    metadata: {
      ...source.metadata,
      title: seed.title ?? `${source.metadata.title} (copy)`,
      created_at: new Date().toISOString(),
    },
  };

  return repository.putManuscript(
    wrap(seed.story_id, 'duplicate', null, copy, {
      story_id: seed.from_story_id,
      package_version: version,
    }),
    null,
  );
}

/**
 * The `package_version` the next publish will write.
 *
 * Exposed so a surface can say which version it is about to create *before* the author commits
 * to it, rather than reporting it afterwards. Same rule as the publish itself: `max(retained) + 1`,
 * never the author's arithmetic (§3).
 */
export async function nextPackageVersion(
  repository: StoryRepository,
  storyId: string,
): Promise<number> {
  const retained = await repository.listPackageVersions(storyId);
  return retained.length === 0 ? 1 : Math.max(...retained) + 1;
}

/**
 * Rename a Manuscript's `story_id` before it has ever published (ADR 0017 §5).
 *
 * A `story_id` is the key of every blob path a story owns, so once a version is retained — and
 * an edition may pin it — the id is fixed. Before that there is nothing to break: the Manuscript
 * is the only thing under that key, and moving it is a write at the new path and a delete at the
 * old one.
 */
export async function renameManuscript(
  repository: StoryRepository,
  fromStoryId: string,
  toStoryId: string,
  expectedUpdatedAt: string | null,
): Promise<Manuscript> {
  const stored = await repository.getManuscript(fromStoryId);
  if (stored === null) {
    throw new ManuscriptSeedError('story_not_found', `no Manuscript for "${fromStoryId}"`);
  }
  if (stored.based_on_version !== null || (await repository.getPointer(fromStoryId)) !== null) {
    throw new ManuscriptSeedError(
      'story_id_taken',
      `"${fromStoryId}" has already published, so its story id is fixed`,
    );
  }
  if (expectedUpdatedAt !== stored.updated_at) {
    throw new ManuscriptConflictError(fromStoryId, stored.updated_at, expectedUpdatedAt);
  }
  if (!(await storyIdAvailable(repository, toStoryId))) {
    const reason = /^[a-z0-9][a-z0-9-]*$/.test(toStoryId) ? 'story_id_taken' : 'invalid_story_id';
    throw new ManuscriptSeedError(reason, `"${toStoryId}" is not available as a story id`);
  }

  const moved = await repository.putManuscript(
    {
      ...stored,
      story_id: toStoryId,
      package: { ...stored.package, story_id: toStoryId },
    },
    null,
  );
  // Only after the new path holds the work: a failed delete leaves a stale copy, which is
  // recoverable, where a failed write after a delete would not be.
  await repository.deleteManuscript(fromStoryId);
  return moved;
}

export class PublishRejectedError extends Error {
  readonly lint: LintResult;

  constructor(storyId: string, lint: LintResult) {
    super(
      `the linter rejected "${storyId}" before publishing: ` +
        lint.errors.map((problem) => `[${problem.code}] ${problem.path} ${problem.message}`).join('; '),
    );
    this.name = 'PublishRejectedError';
    this.lint = lint;
  }
}

export interface PublishResult {
  readonly pointer: PackagePointer;
  readonly published: StoryPackage;
  readonly manuscript: Manuscript;
  readonly lint: LintResult;
}

/**
 * Publish a Manuscript as the next retained `package_version` (ADR 0017 §3).
 *
 * In order, stopping at the first failure: strict-parse → lint → `max(retained) + 1` → retain and
 * repoint → advance `based_on_version`. Three details are load-bearing:
 *
 * - The version is **never** the author's arithmetic and never `based_on_version + 1`.
 *   `max(retained) + 1` is what makes a publish unable to collide with a version an edition
 *   already pins, which is the invariant `putPackage` throws to protect.
 * - The Manuscript **survives** the publish. Clearing it would make an accidental publish
 *   unrecoverable from the screen, and would make the author's next edit start by re-reading the
 *   package they just wrote. Discarding is its own action.
 * - This is the only write that advances the version, so it is the only moment **staleness**
 *   propagates — the deliberate-edit boundary ADR 0015 §3's blunt propagation always assumed.
 */
export async function publishManuscript(
  repository: StoryRepository,
  storyId: string,
): Promise<PublishResult> {
  const manuscript = await repository.getManuscript(storyId);
  if (manuscript === null) {
    throw new ManuscriptSeedError('story_not_found', `no Manuscript for "${storyId}" to publish`);
  }

  const nextVersion = await nextPackageVersion(repository, storyId);
  const candidate = { ...manuscript.package, story_id: storyId, package_version: nextVersion };

  const lint = lintPackage(candidate);
  if (!lint.publishable) throw new PublishRejectedError(storyId, lint);

  // The lint above already strict-parsed it; this is the parse whose *output* is stored, so the
  // schema's own defaults are applied to what lands rather than to a copy thrown away.
  const published = parseStoryPackage(candidate);
  const pointer = await repository.putPackage(published);

  const saved = await repository.putManuscript(
    { ...manuscript, based_on_version: nextVersion, package: candidate },
    manuscript.updated_at,
  );

  return { pointer, published, manuscript: saved, lint };
}
