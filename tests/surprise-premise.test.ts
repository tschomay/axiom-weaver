/**
 * "Surprise me" asks the model for a new premise (`src/arc/surprise-premise.ts`). Offline: a stub
 * client stands in for the model, and the route's author gate is exercised without a key.
 */

import { describe, expect, it } from 'vitest';
import { PLOT_SHAPE_IDS, materializeBrief } from '@/arc/brief';
import {
  SURPRISE_CORNERS,
  drawSurpriseSeed,
  generateSurprisePremise,
  surprisePrompt,
} from '@/arc/surprise-premise';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';

const modules = {
  theme: 'what a small lie costs when the whole valley repeats it',
  setting_time: 'the dry autumn of 1911',
  setting_place: 'a hop farm on a river terrace',
  protagonist: 'a seasonal picker who keeps the tally',
  protagonist_want: 'to be paid for the bushels she actually picked',
  antagonism: 'a foreman skimming from every tally book',
  complication: 'her own brother is the one altering the books',
  ending_shape: 'she is paid, and loses him',
};

function answer(body: unknown): ModelResponse {
  return {
    text: JSON.stringify(body),
    finish_reason: 'STOP',
    model: 'gemini-test',
    usage: { prompt_tokens: 0, output_tokens: 0, cached_tokens: 0, thoughts_tokens: 0 },
  };
}

function scripted(responses: ModelResponse[]) {
  const requests: ModelRequest[] = [];
  const client: ModelClient = {
    generate: async (request) => {
      requests.push(request);
      const next = responses.shift();
      if (next === undefined) throw new Error('out of responses');
      return next;
    },
  };
  return { client, requests };
}

describe('Surprise me, asked of the model', () => {
  it('returns a complete premise on the seeded plot shape that a brief builds from', async () => {
    const { client, requests } = scripted([
      answer({ title: 'Tally Season', logline: 'A hop picker finds her tally cut.', modules }),
    ]);
    const result = await generateSurprisePremise({ client, model: 'gemini-test', random: () => 0 });

    expect(result.premise.title).toBe('Tally Season');
    expect(result.premise.plot_shape_preset).toBe(PLOT_SHAPE_IDS[0]);
    expect(result.premise.premise.modules).toEqual(modules);
    expect(result.model).toBe('gemini-test');
    expect(requests).toHaveLength(1);
    expect(() =>
      materializeBrief({
        story_id: 's',
        title: result.premise.title,
        premise: result.premise.premise,
        plot_shape_preset: result.premise.plot_shape_preset,
      }),
    ).not.toThrow();
  });

  it('tells the model what the author has already seen, so the next press goes somewhere new', () => {
    const prompt = surprisePrompt(drawSurpriseSeed(() => 0.5), ['A ferry sinks in calm water.']);
    expect(prompt).toContain('A ferry sinks in calm water.');
    expect(prompt).toContain('must differ');
  });

  it('draws a different seed from different randomness, and never the same corner twice', () => {
    const seeds = [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((roll) => drawSurpriseSeed(() => roll));
    expect(new Set(seeds.map((seed) => seed.corners.join('|'))).size).toBeGreaterThan(1);
    for (const seed of seeds) {
      expect(seed.corners[0]).not.toBe(seed.corners[1]);
      expect(SURPRISE_CORNERS).toContain(seed.corners[0]);
      expect(PLOT_SHAPE_IDS).toContain(seed.plot_shape_preset);
    }
  });

  it('retries once when the model reaches for a stock default or answers badly, then gives up', async () => {
    const recovered = scripted([
      answer({ title: 'The Lighthouse', logline: 'A lighthouse keeper…', modules }),
      answer({ title: 'Tally Season', logline: 'A hop picker finds her tally cut.', modules }),
    ]);
    const result = await generateSurprisePremise({ client: recovered.client, model: 'gemini-test' });
    expect(result.premise.title).toBe('Tally Season');
    expect(recovered.requests).toHaveLength(2);

    const broken = scripted([answer({ title: 'Half' }), answer('not an object')]);
    await expect(
      generateSurprisePremise({ client: broken.client, model: 'gemini-test' }),
    ).rejects.toThrow(/No usable premise/);
  });
});

describe('POST /api/authoring/surprise', () => {
  it('is author-gated on a deployment, and says when there is no key to ask', async () => {
    const route = await import('../app/api/authoring/surprise/route');
    const post = () =>
      route.POST(new Request('http://t/api/authoring/surprise', { method: 'POST', body: '{}' }));

    const savedBlob = process.env.BLOB_READ_WRITE_TOKEN;
    const savedKey = process.env.GEMINI_API_KEY;
    try {
      process.env.BLOB_READ_WRITE_TOKEN = 'the-real-token';
      expect((await post()).status).toBe(401);

      delete process.env.BLOB_READ_WRITE_TOKEN;
      delete process.env.GEMINI_API_KEY;
      expect((await post()).status).toBe(503);
    } finally {
      if (savedBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = savedBlob;
      if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
    }
  });
});
