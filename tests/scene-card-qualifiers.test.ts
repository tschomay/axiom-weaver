/**
 * Beats keep the details a later scene depends on (#181).
 *
 * The events are The Slackwater Crossing's, reduced: Bram hears an "explosive thump", and a later
 * event links the fittings "to the explosive thump Bram reported". Scene 4's card reworded it to
 * "mechanical crash", pointing scene 5 at words the reader was never given.
 */

import { describe, expect, it } from 'vitest';
import { ExtractionModel } from '@/extraction/call';
import { FabulaArcSchema, type FabulaEvent } from '@/schema/fabula';
import {
  describeScenes,
  draftScenes,
  loadBearingPhrases,
} from '@/segmentation/pass-scene-cards';
import { renderArcPrompt } from '@/arc/prompt';
import { briefsFor } from '@/arc/premises';
import { summarize } from '@/arc/judge';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';

const SEED = {
  characters: [
    { id: 'char_bram', name: 'Bram Cloutier', location_id: 'loc_weir', status: 'alive' },
    { id: 'char_nita', name: 'Nita Vance', location_id: 'loc_weir', status: 'alive' },
  ],
  locations: [{ id: 'loc_weir', name: 'the weir station' }],
  objects: [],
  relationships: [],
  character_knowledge: [],
};

function events(): FabulaEvent[] {
  return FabulaArcSchema.parse({
    title: 't',
    world_model_seed: SEED,
    events: [
      {
        id: 'ev_04',
        sequence: 1,
        summary: 'Bram tells Nita he heard an explosive thump from the ferry just after dusk.',
        location_id: 'loc_weir',
        characters_present: ['char_bram', 'char_nita'],
        beats: ['Bram describes an explosive thump carrying across the slackwater'],
      },
      {
        id: 'ev_05',
        sequence: 2,
        summary: 'Nita links the unapproved fittings to the explosive thump Bram reported.',
        location_id: 'loc_weir',
        characters_present: ['char_nita', 'char_bram'],
        beats: ['Nita suspects the fittings'],
      },
    ],
  }).events;
}

/** Answers the scene-properties call with beats that reword the clue. */
class RewordingClient implements ModelClient {
  generate(request: ModelRequest): Promise<ModelResponse> {
    const numbers = [...request.contents.matchAll(/^SCENE (\d+)$/gm)].map((match) => Number(match[1]));
    return Promise.resolve({
      model: 'stub-model',
      text: JSON.stringify({
        scenes: numbers.map((scene_number) => ({
          scene_number,
          label: `scene ${scene_number}`,
          pov: 'char_nita',
          location_id: 'loc_weir',
          dramatic_function: 'f',
          required_beats: ['Bram reports a mechanical crash'],
        })),
      }),
      finish_reason: 'STOP',
      usage: { prompt_tokens: 0, output_tokens: 0, thoughts_tokens: 0, cached_tokens: 0 },
    } as ModelResponse);
  }
}

describe('load-bearing phrases', () => {
  it('finds the words a later scene repeats, and never a bare character name', () => {
    const [first, second] = events();
    const drafts = draftScenes([[first!], [second!]], FabulaArcSchema.shape.world_model_seed.parse(SEED));
    const phrases = loadBearingPhrases(drafts, FabulaArcSchema.shape.world_model_seed.parse(SEED));
    expect(phrases.get(1)).toEqual(['explosive thump']);
    // Nothing comes after the last scene to refer back.
    expect(phrases.has(2)).toBe(false);
  });

  it('asks the model to keep them, and restores the source beat when it rewords anyway', async () => {
    const seed = FabulaArcSchema.shape.world_model_seed.parse(SEED);
    const [first, second] = events();
    const drafts = draftScenes([[first!], [second!]], seed);
    const requests: string[] = [];
    const client = new RewordingClient();
    const spy: ModelClient = {
      generate: (request) => {
        requests.push(request.contents);
        return client.generate(request);
      },
    };

    const result = await describeScenes(new ExtractionModel(spy, 'stub-model'), drafts, seed);

    expect(requests.join('\n')).toContain('keep verbatim (a later scene refers back to these): "explosive thump"');
    expect(result.phrases_restored).toBe(1);
    expect(result.scenes[0]!.required_beats).toEqual([
      'Bram reports a mechanical crash',
      'Bram tells Nita he heard an explosive thump from the ferry just after dusk.',
    ]);
  });
});

describe('setting rules are plants', () => {
  it('is asked of the generator', () => {
    expect(renderArcPrompt(briefsFor('structured', 8)[0]!)).toContain('SETTING RULES ARE PLANTS');
  });

  it('is scored by the judge, and an old response without it still summarizes', () => {
    const base = {
      causal_pairs: [],
      payoffs: [],
      closest_stock_shape: 'none of these — the arc does not reduce to any shape on this list',
      stock_adherence: 1,
      particulars: [],
      thematic_coherence: 3,
      engagement: 3,
      notes: '',
    };
    expect(summarize(base, 'old', 'judge').setting_rules).toEqual({ rules: 0, unplanted: 0, passed: true });
    const scored = summarize(
      {
        ...base,
        setting_rules: [
          { rule: 'the wreck is reachable on foot at low tide', planted: false, why: '' },
          { rule: 'the weir gates close at dusk', planted: true, why: '' },
        ],
      },
      'new',
      'judge',
    );
    expect(scored.setting_rules).toEqual({ rules: 2, unplanted: 1, passed: false });
  });
});

describe('unmotivated actions', () => {
  const base = {
    causal_pairs: [],
    payoffs: [],
    closest_stock_shape: 'none of these — the arc does not reduce to any shape on this list',
    stock_adherence: 1,
    particulars: [],
    thematic_coherence: 3,
    engagement: 3,
    notes: '',
  };

  it('fails the criterion on any unmotivated action, and passes an old response without it', () => {
    expect(summarize(base, 'old', 'judge').motivated_actions).toEqual({ unmotivated: 0, passed: true });
    const scored = summarize(
      {
        ...base,
        unmotivated_actions: [
          { action: 'Jesse throws the ferry full astern', where: 'E10', why_missing: 'why he reversed' },
        ],
      },
      'new',
      'judge',
    );
    expect(scored.motivated_actions).toEqual({ unmotivated: 1, passed: false });
  });

  it('shows the judge what actually happened when the package states it', async () => {
    const { blindArcView } = await import('@/arc/judge');
    const { readFixturePackage } = await import('@/fixtures/load');
    const pkg = await readFixturePackage('the-dragon-of-thistlewick');
    expect(blindArcView(pkg)).not.toContain('WHAT ACTUALLY HAPPENED');
    const stated = {
      ...pkg,
      facts: [{ fact_ref: 'a_reason', statement: 'She reversed to hold off the weir.', caused_by: [] }],
    };
    expect(blindArcView(stated)).toContain(
      'WHAT ACTUALLY HAPPENED (the stated facts, causes listed after each)\n  a_reason: She reversed to hold off the weir.',
    );
  });
});
