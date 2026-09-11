import { describe, expect, it } from 'vitest';
import { DigestHierarchy, concatenatingSummarizer, modelSummarizer, rollupPrompt } from '@/digest/hierarchy';
import { FALLBACK_MODEL, type ModelClient, type ModelRequest, type ModelResponse } from '@/writer/model-client';
import { levelName, rollUp, sceneDigestEntry, type SceneDigest } from '@/digest/scene-digest';

function digest(overrides: Partial<SceneDigest> = {}): SceneDigest {
  return {
    event_summary: 'something happened',
    entities_on_stage: [],
    facts_revealed: [],
    plants_opened: [],
    payoffs_closed: [],
    imagery_signature: [],
    closing_situation: 'and then it stopped',
    reanchor_used: [],
    grounded_claims: [],
    ...overrides,
  };
}

describe('the recursive digest hierarchy (ADR 0008 §1)', () => {
  it('rolls a level up the instant it fills, and clears it', async () => {
    const hierarchy = new DigestHierarchy(4);

    for (let scene = 1; scene <= 3; scene += 1) {
      expect(await hierarchy.push(digest(), `scene_${scene}`, scene)).toEqual([]);
    }
    expect(hierarchy.size()).toBe(3);

    const fired = await hierarchy.push(digest(), 'scene_4', 4);
    expect(fired).toEqual([{ from_level: 0, to_level: 1, scene_orders: [1, 2, 3, 4] }]);
    // Four Scene Digests became one Chapter Digest: the band cleared, it did not accumulate.
    expect(hierarchy.size()).toBe(1);
    expect(hierarchy.deepestOpenLevel()).toBe(1);
  });

  it('cascades like carrying a digit in base-W counting', async () => {
    const hierarchy = new DigestHierarchy(4);
    for (let scene = 1; scene <= 16; scene += 1) await hierarchy.push(digest(), `scene_${scene}`, scene);

    // 16 scenes at W=4: four level-0 rollups, and the fourth of those fills level 1 too.
    const events = hierarchy.rollupEvents();
    expect(events.filter((event) => event.from_level === 0)).toHaveLength(4);
    expect(events.filter((event) => event.from_level === 1)).toHaveLength(1);
    expect(hierarchy.deepestOpenLevel()).toBe(2);
    expect(hierarchy.size()).toBe(1);
  });

  it('keeps the prompt payload bounded as the book grows — the point of the recursion', async () => {
    const hierarchy = new DigestHierarchy(4);
    const sizes: number[] = [];
    for (let scene = 1; scene <= 600; scene += 1) {
      await hierarchy.push(digest(), `scene_${scene}`, scene);
      sizes.push(hierarchy.size());
    }
    // A fixed two-level scheme would grow one entry per part for the life of the book. Under the
    // recursion, the open payload never exceeds (W-1) items per level across a handful of levels.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(18);
    expect(hierarchy.deepestOpenLevel()).toBeGreaterThanOrEqual(4);
  });

  it('orders the payload coarsest first, oldest first within a level', async () => {
    const hierarchy = new DigestHierarchy(4);
    for (let scene = 1; scene <= 6; scene += 1) await hierarchy.push(digest(), `scene_${scene}`, scene);

    const ordered = hierarchy.inPayloadOrder();
    expect(ordered.map((entry) => entry.level)).toEqual([1, 0, 0]);
    expect(ordered[0]?.scene_orders).toEqual([1, 2, 3, 4]);
    expect(ordered[1]?.scene_orders).toEqual([5]);
    expect(ordered[2]?.scene_orders).toEqual([6]);
  });

  it('names levels the way CONTEXT.md and ADR 0008 do', async () => {
    expect([0, 1, 2, 3, 4].map(levelName)).toEqual(['Scene', 'Chapter', 'Part', 'Book L3', 'Book L4']);
  });
});

describe('rollup shape (ADR 0003 decision 6)', () => {
  const window = [
    sceneDigestEntry(
      digest({
        facts_revealed: ['a'],
        entities_on_stage: ['char_x'],
        imagery_signature: [{ image: 'old image', domain: 'hearth' }],
        closing_situation: 'first close',
      }),
      'scene_1',
      1,
    ),
    sceneDigestEntry(
      digest({
        facts_revealed: ['b', 'a'],
        entities_on_stage: ['char_y'],
        imagery_signature: [
          { image: 'newer', domain: 'hearth' },
          { image: 'newest', domain: null },
        ],
        closing_situation: 'last close',
      }),
      'scene_2',
      2,
    ),
  ];

  it('unions list fields and inherits closing_situation from the window s last scene', async () => {
    const rolled = await rollUp(window, concatenatingSummarizer);
    expect(rolled.level).toBe(1);
    expect(rolled.digest.facts_revealed).toEqual(['a', 'b']);
    expect(rolled.digest.entities_on_stage).toEqual(['char_x', 'char_y']);
    // Not aggregated: a point-in-time fact, not a narrative thread.
    expect(rolled.digest.closing_situation).toBe('last close');
  });

  it('re-caps imagery to three by recency', async () => {
    const wide = [
      ...window,
      sceneDigestEntry(
        digest({
          imagery_signature: [
            { image: 'i3', domain: 'glass' },
            { image: 'i4', domain: 'glass' },
          ],
        }),
        'scene_3',
        3,
      ),
    ];
    const rolled = await rollUp(wide, concatenatingSummarizer);
    expect(rolled.digest.imagery_signature).toHaveLength(3);
    expect(rolled.digest.imagery_signature.map((entry) => entry.image)).toEqual([
      'newest',
      'i3',
      'i4',
    ]);
  });

  it('synthesizes event_summary rather than concatenating scene by scene', async () => {
    const rolled = await rollUp(window, () => ({ event_summary: 'a freshly written summary' }));
    expect(rolled.digest.event_summary).toBe('a freshly written summary');
  });

  it('refuses to roll up an empty window', async () => {
    await expect(rollUp([], concatenatingSummarizer)).rejects.toThrow(/empty window/);
  });
});

describe('rollup synthesis is a model call (ADR 0003 §6, issue #60)', () => {
  class StubClient implements ModelClient {
    readonly requests: ModelRequest[] = [];
    constructor(private readonly reply: string | Error) {}
    async generate(request: ModelRequest): Promise<ModelResponse> {
      this.requests.push(request);
      if (this.reply instanceof Error) throw this.reply;
      return {
        text: this.reply,
        finish_reason: 'STOP',
        model: request.model,
        usage: { prompt_tokens: 90, output_tokens: 30, cached_tokens: 0, thoughts_tokens: 12 },
      };
    }
  }

  const window = [
    sceneDigestEntry(digest({ event_summary: 'She swept the ash.' }), 'scene_1', 1),
    sceneDigestEntry(digest({ event_summary: 'The invitation came.' }), 'scene_2', 2),
  ];

  it('asks the cheap model, never the writer model whose quota is the scarce one', async () => {
    const client = new StubClient(JSON.stringify({ event_summary: 'The household turned.' }));
    const rolled = await rollUp(window, modelSummarizer(client));

    expect(client.requests[0]?.model).toBe(FALLBACK_MODEL);
    expect(rolled.digest.event_summary).toBe('The household turned.');
  });

  it('shows the synthesis the window s digests and tells it not to paste them together', () => {
    const prompt = rollupPrompt(window);
    expect(prompt).toContain('She swept the ash.');
    expect(prompt).toContain('The invitation came.');
    expect(prompt).toMatch(/Chapter Digest/);
    expect(prompt).toMatch(/Do not paste the summaries/);
  });

  it('reports what the call cost, so a rollup is not an unaccounted request', async () => {
    const calls: unknown[] = [];
    const client = new StubClient(JSON.stringify({ event_summary: 'x' }));
    await rollUp(window, modelSummarizer(client, { onCall: (call) => calls.push(call) }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ prompt_tokens: 90, output_tokens: 30 });
  });

  it('falls back to the concatenation when the call fails — a rollup never stops a telling', async () => {
    const client = new StubClient(new Error('503'));
    const rolled = await rollUp(window, modelSummarizer(client));
    expect(rolled.digest.event_summary).toBe('She swept the ash. The invitation came.');
  });
});
