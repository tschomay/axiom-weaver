/**
 * Import and export (issue #90, ADR 0017 §6).
 *
 * The claim under test is the one that makes the narrow forms acceptable: the whole package is
 * always reachable as JSON, and nothing is lost on the way out or back in. Checked against all
 * five fixtures, two of which carry an `_authoring_conventions` block the schema has never heard
 * of — which is exactly the thing a careless import would drop.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository } from '@/persistence/story-repository';
import { FIXTURE_STORY_IDS, fixturePath, readFixturePackage } from '@/fixtures/load';
import { packageVersionPath } from '@/persistence/paths';
import {
  adoptStoryId,
  exportFilename,
  importSummary,
  parseImport,
  serializePackage,
} from '@/authoring/transfer';
import { DraftStoryPackageSchema } from '@/schema/manuscript';

async function fixtureText(fixture: string): Promise<string> {
  return readFile(fixturePath(fixture), 'utf8');
}

describe('a package survives the round trip', () => {
  it.each(FIXTURE_STORY_IDS)('%s: export → import → export is byte-identical', async (fixture) => {
    const first = serializePackage(await readFixturePackage(fixture));

    const back = parseImport(first);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    expect(serializePackage(back.package)).toBe(first);
  });

  it.each(FIXTURE_STORY_IDS)('%s: nothing the schema does not know is dropped', async (fixture) => {
    const onDisk = JSON.parse(await fixtureText(fixture)) as Record<string, unknown>;
    const exported = parseImport(serializePackage(await readFixturePackage(fixture)));
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // Every top-level block the file carried is still there.
    expect(Object.keys(exported.package).sort()).toEqual(
      expect.arrayContaining(Object.keys(onDisk).sort()),
    );

    // And the ones the schema has never heard of come through verbatim — the schema materializes
    // defaults into the blocks it *does* know (`pays_off: []` on a card that declared none),
    // which is the same normalization `putPackage` already applies to anything it stores.
    for (const key of exported.summary.extra_blocks) {
      expect(exported.package[key]).toEqual(onDisk[key]);
    }
  });

  it('carries the `_authoring_conventions` block both long fixtures rely on', async () => {
    const pkg = await readFixturePackage('cinderella');
    expect(pkg).toHaveProperty('_authoring_conventions');

    const back = parseImport(serializePackage(pkg));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.package['_authoring_conventions']).toEqual(
      (pkg as Record<string, unknown>)['_authoring_conventions'],
    );
    expect(back.summary.extra_blocks).toContain('_authoring_conventions');
  });

  it('serializes exactly as the store does, so an export matches the stored bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'axiom-transfer-'));
    try {
      const repository = new StoryRepository(new FileSystemBlobStore(root));
      const pkg = await readFixturePackage('the-dragon-of-thistlewick');
      await repository.putPackage(pkg);

      const stored = await readFile(join(root, packageVersionPath(pkg.story_id, 1)), 'utf8');
      expect(serializePackage(await repository.getPackageVersion(pkg.story_id, 1))).toBe(stored);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('a broken package imports and reports, rather than being refused', () => {
  it('accepts a scene whose references are broken, and names them', async () => {
    // A half-broken import the author can then fix in the editor is more useful than a rejection
    // that leaves them holding a text file with no way in.
    const pkg = (await readFixturePackage('the-dragon-of-thistlewick')) as Record<string, unknown>;
    const broken = serializePackage({
      ...pkg,
      scene_cards: (pkg['scene_cards'] as Array<Record<string, unknown>>).map((scene, index) =>
        index === 0 ? { ...scene, pov: 'char_nobody' } : scene,
      ),
    });

    const result = parseImport(broken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lint.publishable).toBe(false);
    expect(result.lint.errors.some((problem) => problem.message.includes('char_nobody'))).toBe(true);
    expect(result.summary.scenes).toBe(3);
  });

  it('accepts a scene whose shape is wrong, and says the shape is wrong', async () => {
    // The linter stops at a shape violation rather than reporting reference errors over a
    // document whose shape is unknown, so this import reports the blank field and not the
    // dangling reference beside it. Both are on the same card, and fixing the shape surfaces
    // the rest.
    const pkg = (await readFixturePackage('the-dragon-of-thistlewick')) as Record<string, unknown>;
    const broken = serializePackage({
      ...pkg,
      scene_cards: (pkg['scene_cards'] as Array<Record<string, unknown>>).map((scene, index) =>
        index === 0 ? { ...scene, location_id: '' } : scene,
      ),
    });

    const result = parseImport(broken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lint.errors).toHaveLength(1);
    expect(result.lint.errors[0]?.code).toBe('schema.too_small');
    expect(result.lint.errors[0]?.path).toBe(
      'scene_cards.scene_01_the_commission.location_id',
    );
  });

  it('accepts a package that is only half written', () => {
    const result = parseImport(
      serializePackage({ schema_version: '1.0', story_id: 'half', metadata: { title: 'Half' } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.scene_cards).toEqual([]);
    expect(result.lint.publishable).toBe(false);
  });
});

describe('what is refused, and why', () => {
  it('refuses text that is not JSON', () => {
    const result = parseImport('not json at all');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_json');
  });

  it('refuses JSON that is not an object', () => {
    for (const text of ['[]', '"a string"', '42', 'null']) {
      const result = parseImport(text);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('not_an_object');
    }
  });

  it('refuses a shape no form could fix, and says where', () => {
    const result = parseImport('{"story_id":"x","metadata":{"title":"x"},"scene_cards":"nope"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_a_package');
    expect(result.message).toContain('scene_cards');
  });

  it('refuses a package with no title, which is the one metadata field required', () => {
    const result = parseImport('{"story_id":"x","metadata":{}}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_a_package');
  });
});

describe('an import lands in the story it was imported into', () => {
  it('takes the target’s story_id, never the file’s', async () => {
    // Honouring the file's id would let an import rename the story it landed in, or land under an
    // id that belongs to someone else's package.
    const pkg = DraftStoryPackageSchema.parse(await readFixturePackage('cinderella'));
    const adopted = adoptStoryId(pkg, 'somewhere-else');
    expect(adopted.story_id).toBe('somewhere-else');
    expect(adopted.scene_cards).toEqual(pkg.scene_cards);
    // And leaves the object alone when there is nothing to change.
    expect(adoptStoryId(pkg, pkg.story_id)).toBe(pkg);
  });
});

describe('what the author is told before they replace their draft', () => {
  it('summarizes the incoming package', async () => {
    const pkg = DraftStoryPackageSchema.parse(await readFixturePackage('cinderella'));
    const summary = importSummary(pkg);
    expect(summary.title).toBe(pkg.metadata.title);
    expect(summary.scenes).toBe(pkg.scene_cards.length);
    expect(summary.entities).toBeGreaterThan(0);
    expect(summary.package_version).toBe(pkg.package_version);
  });

  it('names the export so it sorts next to its story', () => {
    expect(exportFilename('cinderella', null)).toBe('cinderella.draft.package.json');
    expect(exportFilename('cinderella', 3)).toBe('cinderella.v3.package.json');
  });
});
