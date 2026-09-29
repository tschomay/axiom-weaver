/**
 * The verbatim tail is continued, not restated; the Voice Card's tense holds (#201).
 */

import { describe, expect, it } from 'vitest';

import { assemblePrompt, promptText } from '@/assembler/context-assembler';
import { DigestHierarchy } from '@/digest/hierarchy';
import { ToldLedger } from '@/digest/told-ledger';
import { StoryPackageSchema, type StoryPackage } from '@/schema/story-package';
import { severityOf } from '@/validator/diagnostics';
import { buildImageryLedger } from '@/voice/imagery-ledger';
import { cardFromPreset } from '@/voice/voice-card';
import { writerContract } from '@/writer/contract';
import { sentencesOf, tailEcho, tenseMismatch, tenseProfile } from '@/writer/prose-checks';
import { WorldModel } from '@/world-model/world-model';

describe('tail echo', () => {
  it('flags an opening that restates the tail (panel batch 2026-09-29, story 01)', () => {
    const echo = tailEcho(
      'André stared at his hands. The great hand had failed.',
      'The great hand had failed, rattling like dry lath against the edge of the pass. The tart wept.',
    );
    expect(echo?.overlap).toBe(1);
    expect(echo?.tail).toBe('The great hand had failed.');
  });

  it('passes an opening that continues from the tail', () => {
    expect(
      tailEcho(
        'The great hand had failed.',
        'Across the pass, Julien was already reaching for the tongs. Nobody spoke.',
      ),
    ).toBeNull();
  });

  it('says nothing without a tail, or with a tail too short to judge', () => {
    expect(tailEcho(null, 'Anything at all.')).toBeNull();
    expect(tailEcho('Then silence.', 'Then silence, again.')).toBeNull();
  });

  it('splits sentences with closing quotes attached', () => {
    expect(sentencesOf('He said, "Go." She went. And then')).toEqual([
      'He said, "Go."',
      'She went.',
      'And then',
    ]);
  });
});

describe('tense', () => {
  const past =
    'Maren was at the rail when the lamps went out. She turned, and the stage manager looked up. ' +
    'He had the prompt book open. She stepped into the wings and waited. The curtain was down; ' +
    'the house was silent. She felt the cold of the brick at her back.';
  const present =
    'Maren is at the rail when the lamps go out. She turns, and the stage manager looks up. ' +
    'He has the prompt book open. She steps into the wings and waits. The curtain is down; ' +
    'the house is silent. She feels the cold of the brick at her back.';

  it('counts finite-verb markers in narration, not in dialogue', () => {
    expect(tenseProfile('"I was there," she says. "It was late," he says.')).toEqual({
      past: 0,
      present: 2,
    });
  });

  it('flags a past-tense scene against a present-tense Voice Card, and the reverse', () => {
    expect(tenseMismatch(past, 'present')?.found).toBe('past');
    expect(tenseMismatch(present, 'past')?.found).toBe('present');
  });

  it('passes a scene in the card’s tense, a card with no tense, and a scene too short to judge', () => {
    expect(tenseMismatch(present, 'present')).toBeNull();
    expect(tenseMismatch(past, 'past')).toBeNull();
    expect(tenseMismatch(past, '')).toBeNull();
    expect(tenseMismatch('She was there. He was not.', 'present')).toBeNull();
  });

  it('raises warnings, never errors — a heuristic has no business blocking a scene', () => {
    expect(severityOf('tense_mismatch')).toBe('warn');
    expect(severityOf('tail_echo')).toBe('warn');
  });
});

describe('the writer prompt (#201)', () => {
  const pkg = StoryPackageSchema.parse({
    schema_version: '1.0',
    package_version: 1,
    story_id: 'tense',
    world_model_seed: {
      characters: [{ id: 'char_a', name: 'Maren', location_id: 'loc_a', status: 'alive' }],
      locations: [{ id: 'loc_a', name: 'the wings' }],
      objects: [],
      relationships: [],
      character_knowledge: [],
    },
    scene_cards: [
      {
        id: 'scene_01',
        order: 1,
        pov: 'char_a',
        location_id: 'loc_a',
        characters_present: ['char_a'],
        dramatic_function: 'f',
        entry_state: {},
        exit_state: {},
        required_beats: ['b'],
      },
    ],
    voice_card: {},
    metadata: { title: 't' },
  }) as StoryPackage;

  const text = (tense: string) => {
    const voiceCard = { ...cardFromPreset('gothic_brooding'), tense };
    return promptText(
      assemblePrompt({
        pkg,
        scene: pkg.scene_cards[0]!,
        model: WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed),
        voiceCard,
        hierarchy: new DigestHierarchy(4),
        ledger: ToldLedger.forPackage(pkg),
        imageryLedger: buildImageryLedger(voiceCard, []),
        reanchoring: [],
        plantObligations: [],
        payoffInstructions: [],
        previousParagraph: 'The great hand had failed.',
        writerContract: writerContract(),
      }),
    );
  };

  it('tells the writer to continue from the tail, never restate it', () => {
    expect(text('past')).toContain('never restate or paraphrase its final sentence');
  });

  it('repeats the Voice Card tense in the per-scene tail', () => {
    const prompt = text('present');
    expect(prompt).toContain('TENSE: narrate this scene in the present tense');
    // After the verbatim tail, where the scene's own instructions are.
    expect(prompt.indexOf('TENSE:')).toBeGreaterThan(prompt.indexOf('PREVIOUS SCENE ENDED'));
  });
});
