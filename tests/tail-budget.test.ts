/**
 * The volatile tail keeps what the reader already knows on long stories (#197).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { promptWalk } from '@/assembler/cache-prefix';
import { DEFAULT_VOLATILE_TAIL_BUDGET, TAIL_EVICTION_MARKER } from '@/assembler/context-assembler';
import { tailEvictionSceneCount, type RunReportScene } from '@/edition/run-report';
import { renderRunReport } from '@/edition/report-view';
import { StoryPackageSchema, type StoryPackage } from '@/schema/story-package';
import { WriterResponseSchema } from '@/writer/response-schema';
import { SyntheticWriterClient } from '@/writer/synthetic-client';

const BATCH = join(__dirname, '..', 'prototypes', 'story-review', '2026-09-29');

function batchPackage(prefix: string): StoryPackage {
  const dir = readdirSync(BATCH).find((name) => name.startsWith(prefix))!;
  return StoryPackageSchema.parse(
    JSON.parse(readFileSync(join(BATCH, dir, 'package.json'), 'utf8')),
  ) as StoryPackage;
}

async function walk(pkg: StoryPackage) {
  const client = new SyntheticWriterClient(pkg);
  return promptWalk(pkg, (scene) => {
    const response = WriterResponseSchema.parse(JSON.parse(client.composeFor(scene)));
    return { digest: response.scene_digest, prose: response.prose };
  });
}

describe('volatile-tail budget on the long batch stories (#197)', () => {
  it('starts at 4000 estimated tokens', () => {
    expect(DEFAULT_VOLATILE_TAIL_BUDGET).toBe(4000);
  });

  for (const prefix of ['04-', '05-']) {
    it(`${prefix} evicts nothing at priority 4 or above in any scene`, async () => {
      const prompts = await walk(batchPackage(prefix));
      expect(prompts.length).toBeGreaterThan(10);
      for (const { scene, assembled } of prompts) {
        const lost = assembled.tail_groups.filter((group) => group.priority <= 4 && !group.included);
        expect(lost.map((group) => group.name), scene.id).toEqual([]);
      }
    });
  }

  it('evicts the knows-already groups after the relationship edges', async () => {
    const [first] = await walk(batchPackage('04-'));
    const names = first!.assembled.tail_groups.map((group) => group.name);
    const at = (fragment: string) => names.findIndex((name) => name.includes(fragment));
    expect(at("told-ledger rows for this scene's own facts")).toBe(0);
    expect(at('met: facts')).toBeLessThan(at('relationships between two present entities'));
    expect(at('term: facts')).toBeLessThan(at('relationships between two present entities'));
    expect(at('relationships touching one present entity')).toBe(names.length - 1);
  });
});

describe('eviction count in the run report (#197)', () => {
  const scene = (index: number, messages: string[]): RunReportScene => ({
    scene_id: `scene_${index}`,
    scene_index: index,
    degraded: false,
    duration_ms: 0,
    calls: [],
    repairs: [],
    diagnostics: messages.map((message) => ({
      code: 'missing_fact' as const,
      severity: 'warn' as const,
      surfaces: ['run_report' as const],
      entity_id: null,
      column: null,
      message,
    })),
  });

  const evicted = `dropped "relationships" (~40 tokens) from scene "s" — ${TAIL_EVICTION_MARKER} 4000 exhausted`;

  it('counts scenes, not diagnostics, and only tail evictions', () => {
    const scenes = [
      scene(1, [evicted, evicted]),
      scene(2, ['"Gable" has an on-page beat in s2 but is absent from characters_present']),
      scene(3, []),
      scene(4, [evicted]),
    ];
    expect(tailEvictionSceneCount(scenes)).toBe(2);
  });

  it('puts the count on the summary line', () => {
    const report = {
      schema_version: '1.0',
      run_id: 'run_1',
      story_id: 'x',
      package_version: 1,
      occasion: 'author_time' as const,
      status: 'complete' as const,
      degraded: false,
      degraded_scene_count: 0,
      scene_count: 2,
      budget: {
        expected_output_tokens: 0,
        output_tokens: 0,
        thoughts_tokens: 0,
        prompt_tokens: 0,
        cached_tokens: 0,
        over_budget: false,
      },
      started_at: '2026-09-29T00:00:00Z',
      completed_at: null,
      duration_ms: 0,
      scenes: [scene(1, [evicted]), scene(2, [])],
    };
    expect(renderRunReport(report)).toContain(
      'scenes           2 of 2, 1 dropped context to fit the volatile-tail budget',
    );
    expect(renderRunReport({ ...report, scenes: [scene(1, []), scene(2, [])] })).not.toContain(
      'dropped context',
    );
  });
});
