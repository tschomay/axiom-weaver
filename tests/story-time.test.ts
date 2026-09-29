/**
 * Story time and period reach the writer (#219).
 */

import { describe, expect, it } from 'vitest';

import { draftPackage } from '@/arc/fabula';
import { briefsFor } from '@/arc/premises';
import { arcResponseJsonSchema, renderArcPrompt } from '@/arc/prompt';
import { assemblePrompt, promptText } from '@/assembler/context-assembler';
import { projectFabulaArc } from '@/authoring/lint-fabula';
import { DigestHierarchy } from '@/digest/hierarchy';
import { ToldLedger } from '@/digest/told-ledger';
import { FabulaArcSchema, readFabulaArc, type FabulaEvent } from '@/schema/fabula';
import { StoryPackageSchema, type StoryPackage } from '@/schema/story-package';
import { segmentMechanically, storyTimeOf } from '@/segmentation/segment';
import { buildImageryLedger } from '@/voice/imagery-ledger';
import { cardFromPreset } from '@/voice/voice-card';
import { writerContract } from '@/writer/contract';
import { WorldModel } from '@/world-model/world-model';

const SEED = {
  characters: [{ id: 'char_arthur', name: 'Arthur', location_id: 'loc_boiler', status: 'alive' }],
  locations: [{ id: 'loc_boiler', name: 'the boiler room' }],
  objects: [],
  relationships: [],
  character_knowledge: [],
};

const arc = FabulaArcSchema.parse({
  title: 'the night shift letter',
  period: '1950s Hull; no telephones in homes, letters and telegrams',
  world_model_seed: SEED,
  events: [
    { id: 'ev_01', sequence: 1, summary: 'Morning muster.', characters_present: ['char_arthur'], beats: ['b'], story_time: 'day 1, morning' },
    { id: 'ev_02', sequence: 2, summary: 'The overheard flue.', characters_present: ['char_arthur'], beats: ['b'], caused_by: ['ev_01'], story_time: 'day 1, morning' },
    { id: 'ev_03', sequence: 3, summary: 'The evening lockout.', characters_present: ['char_arthur'], beats: ['b'], caused_by: ['ev_02'], story_time: 'day 1, seven in the evening' },
  ],
});

describe('story time on the arc and the cards (#219)', () => {
  it('asks the generator for a period and a story time per event', () => {
    const brief = briefsFor('structured', 6)[0]!;
    const prompt = renderArcPrompt(brief);
    expect(prompt).toContain('PERIOD —');
    expect(prompt).toContain('story_time: WHEN it happens');
    const schema = arcResponseJsonSchema(6) as {
      required: string[];
      properties: { events: { items: { required: string[] } } };
    };
    expect(schema.required).toContain('period');
    expect(schema.properties.events.items.required).toContain('story_time');
  });

  it('carries the first event time, or first → last when a scene spans two', () => {
    const [a, b, c] = arc.events as [FabulaEvent, FabulaEvent, FabulaEvent];
    expect(storyTimeOf([a, b])).toEqual({ story_time: 'day 1, morning' });
    expect(storyTimeOf([b, c])).toEqual({ story_time: 'day 1, morning → day 1, seven in the evening' });
    expect(storyTimeOf([{ ...a, story_time: undefined }])).toEqual({});
  });

  it('puts the period in the package metadata, where it reads back, and story times on cards', () => {
    const envelope = draftPackage(arc, 'nsl', {
      generator: 'test',
      model: 'm',
      generated_at: '2026-09-29T00:00:00Z',
      brief: briefsFor('structured', 6)[0]!,
      repairs: [],
    });
    expect((envelope['metadata'] as { period?: string }).period).toBe(arc.period);
    expect(readFabulaArc(envelope).arc.period).toBe(arc.period);
    const { package: pkg } = segmentMechanically(envelope);
    expect(pkg.scene_cards.every((card) => typeof card.story_time === 'string')).toBe(true);
    expect(projectFabulaArc(arc, 'x').package.scene_cards[2]!.story_time).toBe('day 1, seven in the evening');
  });
});

describe('the writer is told when, and in what era (#219)', () => {
  const pkg = StoryPackageSchema.parse({
    schema_version: '1.0',
    package_version: 1,
    story_id: 'nsl',
    world_model_seed: SEED,
    scene_cards: [
      { id: 's10', order: 10, pov: 'char_arthur', location_id: 'loc_boiler', characters_present: ['char_arthur'], dramatic_function: 'f', entry_state: {}, exit_state: {}, required_beats: ['b'], story_time: 'day 3, morning muster' },
      { id: 's11', order: 11, pov: 'char_arthur', location_id: 'loc_boiler', characters_present: ['char_arthur'], dramatic_function: 'f', entry_state: {}, exit_state: {}, required_beats: ['b'], story_time: 'day 3, 6:57 in the evening' },
    ],
    voice_card: {},
    metadata: { title: 'The Night Shift Letter', period: '1950s Hull; no telephones in homes' },
  }) as StoryPackage;

  it('renders the period in the header, WHEN on the card, and the previous scene time at the seam', () => {
    const voiceCard = cardFromPreset('gothic_brooding');
    const assembled = assemblePrompt({
      pkg,
      scene: pkg.scene_cards[1]!,
      model: WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed),
      voiceCard,
      hierarchy: new DigestHierarchy(4),
      ledger: ToldLedger.forPackage(pkg),
      imageryLedger: buildImageryLedger(voiceCard, []),
      reanchoring: [],
      plantObligations: [],
      payoffInstructions: [],
      previousParagraph: 'He could walk away.',
      writerContract: writerContract(),
    });
    expect(assembled.header.text).toContain('PERIOD: 1950s Hull; no telephones in homes — nothing in the prose may belong to another era.');
    const text = promptText(assembled);
    expect(text).toContain('WHEN: day 3, 6:57 in the evening');
    expect(text).toContain('PREVIOUS SCENE ENDED (story time: day 3, morning muster)');
    expect(text).toContain('if this scene is at a different time, say so in its first lines');
  });
});
