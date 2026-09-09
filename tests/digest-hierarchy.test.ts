import { describe, expect, it } from 'vitest';
import { DigestHierarchy, concatenatingSummarizer } from '@/digest/hierarchy';
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
    ...overrides,
  };
}

describe('the recursive digest hierarchy (ADR 0008 §1)', () => {
  it('rolls a level up the instant it fills, and clears it', () => {
    const hierarchy = new DigestHierarchy(4);

    for (let scene = 1; scene <= 3; scene += 1) {
      expect(hierarchy.push(digest(), `scene_${scene}`, scene)).toEqual([]);
    }
    expect(hierarchy.size()).toBe(3);

    const fired = hierarchy.push(digest(), 'scene_4', 4);
    expect(fired).toEqual([{ from_level: 0, to_level: 1, scene_orders: [1, 2, 3, 4] }]);
    // Four Scene Digests became one Chapter Digest: the band cleared, it did not accumulate.
    expect(hierarchy.size()).toBe(1);
    expect(hierarchy.deepestOpenLevel()).toBe(1);
  });

  it('cascades like carrying a digit in base-W counting', () => {
    const hierarchy = new DigestHierarchy(4);
    for (let scene = 1; scene <= 16; scene += 1) hierarchy.push(digest(), `scene_${scene}`, scene);

    // 16 scenes at W=4: four level-0 rollups, and the fourth of those fills level 1 too.
    const events = hierarchy.rollupEvents();
    expect(events.filter((event) => event.from_level === 0)).toHaveLength(4);
    expect(events.filter((event) => event.from_level === 1)).toHaveLength(1);
    expect(hierarchy.deepestOpenLevel()).toBe(2);
    expect(hierarchy.size()).toBe(1);
  });

  it('keeps the prompt payload bounded as the book grows — the point of the recursion', () => {
    const hierarchy = new DigestHierarchy(4);
    const sizes: number[] = [];
    for (let scene = 1; scene <= 600; scene += 1) {
      hierarchy.push(digest(), `scene_${scene}`, scene);
      sizes.push(hierarchy.size());
    }
    // A fixed two-level scheme would grow one entry per part for the life of the book. Under the
    // recursion, the open payload never exceeds (W-1) items per level across a handful of levels.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(18);
    expect(hierarchy.deepestOpenLevel()).toBeGreaterThanOrEqual(4);
  });

  it('orders the payload coarsest first, oldest first within a level', () => {
    const hierarchy = new DigestHierarchy(4);
    for (let scene = 1; scene <= 6; scene += 1) hierarchy.push(digest(), `scene_${scene}`, scene);

    const ordered = hierarchy.inPayloadOrder();
    expect(ordered.map((entry) => entry.level)).toEqual([1, 0, 0]);
    expect(ordered[0]?.scene_orders).toEqual([1, 2, 3, 4]);
    expect(ordered[1]?.scene_orders).toEqual([5]);
    expect(ordered[2]?.scene_orders).toEqual([6]);
  });

  it('names levels the way CONTEXT.md and ADR 0008 do', () => {
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

  it('unions list fields and inherits closing_situation from the window s last scene', () => {
    const rolled = rollUp(window, concatenatingSummarizer);
    expect(rolled.level).toBe(1);
    expect(rolled.digest.facts_revealed).toEqual(['a', 'b']);
    expect(rolled.digest.entities_on_stage).toEqual(['char_x', 'char_y']);
    // Not aggregated: a point-in-time fact, not a narrative thread.
    expect(rolled.digest.closing_situation).toBe('last close');
  });

  it('re-caps imagery to three by recency', () => {
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
    const rolled = rollUp(wide, concatenatingSummarizer);
    expect(rolled.digest.imagery_signature).toHaveLength(3);
    expect(rolled.digest.imagery_signature.map((entry) => entry.image)).toEqual([
      'newest',
      'i3',
      'i4',
    ]);
  });

  it('synthesizes event_summary rather than concatenating scene by scene', () => {
    const rolled = rollUp(window, () => ({ event_summary: 'a freshly written summary' }));
    expect(rolled.digest.event_summary).toBe('a freshly written summary');
  });

  it('refuses to roll up an empty window', () => {
    expect(() => rollUp([], concatenatingSummarizer)).toThrow(/empty window/);
  });
});
