import { describe, expect, it } from 'vitest';
import { readFixturePackage, FIXTURE_STORY_IDS } from '@/fixtures/load';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { WriterResponseSchema } from '@/writer/response-schema';
import {
  cacheablePrefixOf,
  prefixSurvives,
  promptWalk,
  sharedPrefix,
  wirePromptOf,
} from '@/assembler/cache-prefix';
import { estimateTokens } from '@/assembler/context-assembler';
import { MIN_CACHEABLE_TOKENS } from '@/writer/model-client';

/**
 * Issue #50's standing guard.
 *
 * Caching is a prefix match, so ADR 0008's payload order is only worth its complexity while
 * scene N's stable prefix is still intact at the head of scene N+1's prompt. An ordering mistake
 * is invisible in the prose and shows up live only as `cachedContentTokenCount` staying at zero —
 * which is a slow, expensive way to learn that someone moved a World Model row up the payload.
 * These tests are the fast way.
 */
function walkFixture(fixture: string) {
  return readFixturePackage(fixture).then((pkg) => {
    const client = new SyntheticWriterClient(pkg);
    return promptWalk(pkg, (scene) => {
      const response = WriterResponseSchema.parse(JSON.parse(client.composeFor(scene)));
      return { digest: response.scene_digest, prose: response.prose };
    });
  });
}

describe.each(FIXTURE_STORY_IDS)('cacheable prefix — %s', (fixture) => {
  it('survives from each scene into the next, except where a rollup rewrites the middle', async () => {
    const walked = await walkFixture(fixture);
    const unexplained: string[] = [];
    let rollupResets = 0;

    for (const [index, prompt] of walked.entries()) {
      const previous = walked[index - 1];
      if (previous === undefined) continue;
      if (prefixSurvives(previous, prompt)) continue;
      // ADR 0008: a rollup replaces N scene digests with one, rewriting the middle of the prompt.
      // Expected, and budgeted for — one expensive scene per closed window.
      if (prompt.after_rollup) rollupResets += 1;
      else unexplained.push(prompt.scene.id);
    }

    expect(unexplained).toEqual([]);
    expect(rollupResets).toBeGreaterThan(0);
  });

  it('holds the header and digest hierarchy, and nothing that changes every scene', async () => {
    const walked = await walkFixture(fixture);
    const prompt = walked[3]!;
    const prefix = cacheablePrefixOf(prompt.assembled);

    expect(wirePromptOf(prompt.assembled).startsWith(prefix)).toBe(true);
    expect(prefix).toContain(prompt.assembled.header.text);
    // The two segments ADR 0008 marks volatile are outside the prefix by construction.
    expect(prefix).not.toContain(prompt.assembled.volatile_tail.text);
    if (prompt.assembled.verbatim_tail.text !== '') {
      expect(prefix).not.toContain(prompt.assembled.verbatim_tail.text);
    }
  });

  it('grows the shared prefix as the telling accumulates', async () => {
    const walked = await walkFixture(fixture);
    const shared = walked
      .slice(1)
      .map((prompt, index) => estimateTokens(sharedPrefix(walked[index]!.wire_prompt, prompt.wire_prompt)));

    // Not monotonic — a rollup resets it — but the story ends with more shared than it started.
    expect(shared.at(-1)!).toBeGreaterThan(shared[0]!);
  });
});

describe('why nothing cached on the live runs (#50)', () => {
  it('is the model’s 4,096-token minimum, not the ordering', async () => {
    const walked = await walkFixture('cinderella');
    const widest = Math.max(
      ...walked
        .slice(1)
        .map((prompt, index) =>
          estimateTokens(sharedPrefix(walked[index]!.wire_prompt, prompt.wire_prompt)),
        ),
    );

    // Measured with countTokens at 1,943 real tokens; the estimate tracks it within ~4%. Either
    // way it is nowhere near the minimum, which is why two live runs cached nothing. If a fixture
    // ever grows past this, the run reports should start showing cache hits — and this assertion
    // should be the thing that tells you to go and look.
    expect(widest).toBeLessThan(MIN_CACHEABLE_TOKENS);
  });
});
