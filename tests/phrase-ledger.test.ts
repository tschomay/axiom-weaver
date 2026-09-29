/**
 * Worn phrases and repeated openings are shown to the writer; known facts are referred to, not
 * retold (#220).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  WORN_PHRASE_SCENES,
  buildPhraseLedger,
  recordPhrases,
  renderPhraseLedger,
  nameWords,
  trigramsOf,
} from '@/voice/phrase-ledger';
import { assemblePrompt, promptText } from '@/assembler/context-assembler';
import { DigestHierarchy } from '@/digest/hierarchy';
import { ToldLedger } from '@/digest/told-ledger';
import { StoryPackageSchema, type StoryPackage } from '@/schema/story-package';
import { buildImageryLedger } from '@/voice/imagery-ledger';
import { cardFromPreset } from '@/voice/voice-card';
import { writerContract } from '@/writer/contract';
import { WorldModel } from '@/world-model/world-model';

const BATCHES = join(__dirname, '..', 'prototypes', 'story-review');

function scenesOf(path: string): string[] {
  return readFileSync(join(BATCHES, path), 'utf8')
    .split(/^## Scene \d+.*$/m)
    .slice(1)
    .map((scene) => scene.replace(/<!--.*?-->/g, '').trim());
}

describe('the phrase ledger', () => {
  it('keeps names, places and numbers out, and a World Model name is never worn', () => {
    const grams = trigramsOf('She walked past St Jude’s gate with seven hundred and forty pounds in the blue notebook.');
    expect([...grams].some((gram) => gram.includes('jude'))).toBe(false);
    expect([...grams].some((gram) => gram.includes('hundred'))).toBe(false);
    const history = [1, 2, 3].map((order) => recordPhrases('He opened the blue notebook slowly.', order));
    const mentions = (ledger: ReturnType<typeof buildPhraseLedger>) =>
      ledger.worn.some((entry) => entry.phrase.includes('blue notebook'));
    expect(mentions(buildPhraseLedger(history))).toBe(true);
    expect(mentions(buildPhraseLedger(history, { namedWords: nameWords(['the blue notebook']) }))).toBe(false);
  });

  it('ignores dialogue and trigrams made of stopwords', () => {
    const grams = trigramsOf('"Against her ribs," he said. She pressed it against her ribs and the door.');
    expect(grams.has('against her ribs')).toBe(true);
    expect(grams.has('and the door')).toBe(false); // one content word
    expect([...grams].some((gram) => gram.includes('said'))).toBe(false);
  });

  it(`calls a phrase worn once it is in ${WORN_PHRASE_SCENES} scenes, not before`, () => {
    const scene = (order: number, prose: string) => recordPhrases(prose, order);
    const twice = [scene(1, 'The key sat cold against her ribs.'), scene(2, 'Again it pressed against her ribs.')];
    expect(buildPhraseLedger(twice).worn).toEqual([]);
    const thrice = [...twice, scene(3, 'She felt the brass against her ribs once more.')];
    expect(buildPhraseLedger(thrice).worn[0]).toEqual({ phrase: 'against her ribs', scenes: 3 });
  });

  it('finds the random-batch Toll tag and the after-batch Toll tag in the real prose', () => {
    const toll = scenesOf('2026-09-29-random/04-review-toll/story.md').map((prose, i) => recordPhrases(prose, i + 1));
    expect(buildPhraseLedger(toll).worn.map((entry) => entry.phrase)).toContain('against her ribs');
    const after = scenesOf('2026-09-29-after/03-review-toll/story.md').map((prose, i) => recordPhrases(prose, i + 1));
    expect(buildPhraseLedger(after).worn.map((entry) => entry.phrase)).toContain('grease burn scars');
  });

  it('shows the last three openings, so a scene does not open on the same move again', () => {
    const understudy = scenesOf('2026-09-29-after/05-review-understudy/story.md').map((prose, i) =>
      recordPhrases(prose, i + 1),
    );
    const ledger = buildPhraseLedger(understudy.slice(0, 6));
    expect(ledger.recent_openings).toHaveLength(3);
    expect(renderPhraseLedger(ledger)).toContain('RECENT SCENE OPENINGS');
    expect(renderPhraseLedger(buildPhraseLedger([]))).toBe('');
  });
});

describe('the writer prompt (#220)', () => {
  const pkg = StoryPackageSchema.parse({
    schema_version: '1.0',
    package_version: 1,
    story_id: 'p',
    world_model_seed: {
      characters: [{ id: 'char_a', name: 'Teresa', location_id: 'loc_a', status: 'alive' }],
      locations: [{ id: 'loc_a', name: 'the dam' }],
      objects: [],
      relationships: [],
      character_knowledge: [],
    },
    scene_cards: [
      {
        id: 's1', order: 1, pov: 'char_a', location_id: 'loc_a', characters_present: ['char_a'],
        dramatic_function: 'f', entry_state: {}, exit_state: {}, required_beats: ['b'],
        reader_must_learn: ['kenneth_pension'],
      },
      {
        id: 's2', order: 2, pov: 'char_a', location_id: 'loc_a', characters_present: ['char_a'],
        dramatic_function: 'f', entry_state: {}, exit_state: {}, required_beats: ['b'],
        recounts: ['kenneth_pension'],
      },
    ],
    voice_card: {},
    metadata: { title: 't' },
  }) as StoryPackage;

  it('renders a retelling as a clause, naming the scene that told it, and shows worn phrases', () => {
    const voiceCard = cardFromPreset('gothic_brooding');
    const ledger = ToldLedger.forPackage(pkg);
    ledger.touch('kenneth_pension', 1);
    const history = [1, 2, 3].map((order) => recordPhrases('The chisel sat cold against her ribs.', order));
    const text = promptText(
      assemblePrompt({
        pkg,
        scene: pkg.scene_cards[1]!,
        model: WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed),
        voiceCard,
        hierarchy: new DigestHierarchy(4),
        ledger,
        imageryLedger: buildImageryLedger(voiceCard, []),
        phraseLedger: buildPhraseLedger(history),
        reanchoring: [],
        plantObligations: [],
        payoffInstructions: [],
        previousParagraph: null,
        writerContract: writerContract(),
      }),
    );
    expect(text).toContain('refer to them in a clause');
    expect(text).toContain('never re-narrate them');
    expect(text).toContain('kenneth_pension (told in scene 1)');
    expect(text).toContain('WORN PHRASES');
    expect(text).toContain('"against her ribs" (3 scenes)');
  });
});
