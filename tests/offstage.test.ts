/**
 * An event no card authors, reported by the prose, is flagged (#213).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { offstageInventions } from '@/continuity/offstage';
import { StoryPackageSchema, type SceneCard, type StoryPackage } from '@/schema/story-package';
import { severityOf } from '@/validator/diagnostics';

const BASELINE = join(__dirname, '..', 'prototypes', 'story-review', '2026-09-29');

function baseline04(): { pkg: StoryPackage; cards: SceneCard[]; scenes: string[] } {
  const dir = readdirSync(BASELINE).find((name) => name.startsWith('04-'))!;
  const pkg = StoryPackageSchema.parse(
    JSON.parse(readFileSync(join(BASELINE, dir, 'package.json'), 'utf8')),
  ) as StoryPackage;
  const scenes = readFileSync(join(BASELINE, dir, 'story.md'), 'utf8')
    .split(/^## Scene \d+.*$/m)
    .slice(1)
    .map((scene) => scene.replace(/<!--.*?-->/g, '').trim());
  return { pkg, cards: [...pkg.scene_cards].sort((a, b) => a.order - b.order), scenes };
}

const none = { established_details: [] };

describe('offstage reports', () => {
  it("flags the baseline's envelope swap: Clara, off the card, 'took' something no beat authors", () => {
    const { pkg, cards, scenes } = baseline04();
    const findings = offstageInventions({ pkg, scene: cards[15]!, prose: scenes[15]!, digest: none, isTracked: () => true });
    expect(findings.map((finding) => finding.kind)).toContain('offstage_report');
    expect(findings[0]!.detail).toContain('Clara Miller');
    expect(findings[0]!.detail).toContain('manifest duplicates');
  });

  const pkg = StoryPackageSchema.parse({
    schema_version: '1.0',
    package_version: 1,
    story_id: 'x',
    world_model_seed: {
      characters: [
        { id: 'char_arthur', name: 'Arthur Finch', location_id: 'loc_a', status: 'alive' },
        { id: 'char_martin', name: 'Martin Finch', location_id: 'loc_a', status: 'alive' },
        { id: 'char_clara', name: 'Clara Miller', location_id: 'loc_a', status: 'alive' },
      ],
      locations: [{ id: 'loc_a', name: 'the dock' }],
      objects: [],
      relationships: [],
      character_knowledge: [],
    },
    scene_cards: [
      {
        id: 's1', order: 1, pov: 'char_arthur', location_id: 'loc_a', characters_present: ['char_arthur'],
        dramatic_function: 'Arthur learns the lease is gone.', entry_state: {}, exit_state: {},
        required_beats: ['Arthur learns Clara sold the lease'],
      },
    ],
    voice_card: {},
    metadata: { title: 't' },
  }) as StoryPackage;
  const check = (prose: string) =>
    offstageInventions({ pkg, scene: pkg.scene_cards[0]!, prose, digest: none, isTracked: () => true });

  it('passes an act the card authors, a participle used as an adjective, and a shared surname', () => {
    expect(check('Clara sold the lease on Tuesday.')).toEqual([]);
    expect(check('Clara stood among the broken crates.')).toEqual([]);
    // "Finch" is Arthur's too, and Arthur is on the card.
    expect(check('Finch slipped through the blast door.')).toEqual([]);
    // Martin is off the card, and nothing authors a swap.
    expect(check('Martin had quietly swapped the envelopes at dawn.')[0]?.detail).toContain('"swapped"');
  });
});

describe('invented props', () => {
  const pkg = StoryPackageSchema.parse({
    schema_version: '1.0',
    package_version: 1,
    story_id: 'x',
    world_model_seed: {
      characters: [{ id: 'char_arthur', name: 'Arthur Finch', location_id: 'loc_a', status: 'alive' }],
      locations: [{ id: 'loc_a', name: 'the dock' }],
      objects: [],
      relationships: [],
      character_knowledge: [],
    },
    scene_cards: [
      {
        id: 's1', order: 1, pov: 'char_arthur', location_id: 'loc_a', characters_present: ['char_arthur'],
        dramatic_function: 'Arthur opens the blue notebook.', entry_state: {}, exit_state: {}, required_beats: ['b'],
      },
    ],
    voice_card: {},
    metadata: { title: 't' },
  }) as StoryPackage;

  it('flags a prop no card names and the World Model lacks; passes one a card names', () => {
    const findings = offstageInventions({
      pkg,
      scene: pkg.scene_cards[0]!,
      prose: 'He waited.',
      digest: {
        established_details: [
          { entity_id: 'prop_manifest_duplicates', attribute: 'count', value: 'a fat envelope of them' },
          { entity_id: 'prop_blue_notebook', attribute: 'color', value: 'blue' },
        ],
      },
      isTracked: () => false,
    });
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'invented_prop', detail: expect.stringContaining('prop_manifest_duplicates') }),
    ]);
  });

  it('is a warning, never an error', () => {
    expect(severityOf('offstage_invention')).toBe('warn');
  });
});
