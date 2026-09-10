/**
 * Why a compile does or does not get a cache hit — measured, and by default without spending a
 * call.
 *
 * Issue #50: two live runs, 30 calls, `cachedContentTokenCount: 0` every time. Caching is a
 * *prefix* match (`docs/research/gemini-capabilities.md` §2), so there are exactly two ways to
 * lose it, and this script asks both questions:
 *
 *   1. **Does the prefix survive?** If scene N's cacheable prefix is not intact at the head of
 *      scene N+1's prompt, nothing past the first differing byte can cache, however stable it
 *      looks. A reset at a rollup is expected — ADR 0008 calls that a cache-invalidating event —
 *      and a reset anywhere else is a bug in the assembly.
 *   2. **Is the prefix big enough?** Gemini 3.x caches nothing below 4,096 tokens, implicitly or
 *      explicitly. A perfectly ordered prompt that never reaches the minimum never caches.
 *
 *   npm run cache-check                                 # cinderella, offline estimates
 *   npm run cache-check -- cinderella --count-tokens    # real token counts, needs a key
 *   npm run cache-check -- a-christmas-carol --verbose
 *
 * `--count-tokens` calls `models.countTokens`, which is a different endpoint from
 * `generateContent` and generates nothing: it works on a key whose generate quota is spent, and
 * it is the only way to settle a question about a threshold measured in real tokens.
 */

import { readFixturePackage } from '../src/fixtures/load';
import { SyntheticWriterClient } from '../src/writer/synthetic-client';
import { WriterResponseSchema } from '../src/writer/response-schema';
import { estimateTokens } from '../src/assembler/context-assembler';
import { prefixSurvives, promptWalk, sharedPrefix } from '../src/assembler/cache-prefix';
import { GeminiClient, MIN_CACHEABLE_TOKENS, WRITER_MODEL } from '../src/writer/model-client';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const useCountTokens = args.includes('--count-tokens');
  const fixture = args.find((arg) => !arg.startsWith('--')) ?? 'cinderella';

  const live = useCountTokens ? GeminiClient.fromEnv() : null;
  if (useCountTokens && live === null) {
    console.error('--count-tokens needs GEMINI_API_KEY; falling back to estimates.\n');
  }

  const pkg = await readFixturePackage(fixture);
  const client = new SyntheticWriterClient(pkg);

  // The stand-in writer supplies what earlier scenes would have produced. Its prose is filler and
  // its digests are the Scene Cards' own declarations, which is all the assembler consumes — so
  // the sizes below are the real ones for this story at this length.
  const walked = promptWalk(pkg, (scene) => {
    const response = WriterResponseSchema.parse(JSON.parse(client.composeFor(scene)));
    return { digest: response.scene_digest, prose: response.prose };
  });

  console.log(`\n${'#'.repeat(78)}`);
  console.log(`# ${fixture} — cache prefix check`);
  console.log(`# Gemini 3.x caches nothing below ${MIN_CACHEABLE_TOKENS} tokens of prefix`);
  console.log(`${'#'.repeat(78)}\n`);

  const measure = async (text: string): Promise<number> =>
    live === null ? estimateTokens(text) : live.countTokens(WRITER_MODEL, { contents: text });

  let unexplainedResets = 0;
  let rollupResets = 0;
  let everEligible = false;
  let widestShared = 0;

  for (const [index, prompt] of walked.entries()) {
    const previous = walked[index - 1];
    const shared = previous === undefined ? null : sharedPrefix(previous.wire_prompt, prompt.wire_prompt);
    const sharedTokens = shared === null || shared === '' ? null : await measure(shared);
    const wholeTokens = await measure(prompt.wire_prompt);

    const holds = previous === undefined || prefixSurvives(previous, prompt);
    if (!holds) {
      if (prompt.after_rollup) rollupResets += 1;
      else unexplainedResets += 1;
    }
    if (sharedTokens !== null) widestShared = Math.max(widestShared, sharedTokens);
    if (sharedTokens !== null && sharedTokens >= MIN_CACHEABLE_TOKENS) everEligible = true;

    const verdict = !holds
      ? prompt.after_rollup
        ? 'prefix reset by a rollup (ADR 0008 predicts this)'
        : '** PREFIX BROKEN — nothing explains this **'
      : sharedTokens === null
        ? ''
        : sharedTokens >= MIN_CACHEABLE_TOKENS
          ? 'CACHEABLE'
          : 'below the minimum';

    console.log(
      `  ${String(index + 1).padStart(2)} ${prompt.scene.id.padEnd(38)} ` +
        `prompt ${String(wholeTokens).padStart(5)}  ` +
        `shared with previous ${sharedTokens === null ? '    —' : String(sharedTokens).padStart(5)}  ` +
        verdict,
    );

    if (verbose && !holds && previous !== undefined && shared !== null) {
      console.log(`      first divergence at byte ${shared.length}:`);
      console.log(`        previous: ${JSON.stringify(previous.wire_prompt.slice(shared.length, shared.length + 120))}`);
      console.log(`        this one: ${JSON.stringify(prompt.wire_prompt.slice(shared.length, shared.length + 120))}`);
    }
  }

  console.log('');
  console.log(
    unexplainedResets === 0
      ? `  Ordering holds. ${rollupResets} prefix reset(s), every one of them at a rollup, which ADR 0008\n  already calls a cache-invalidating event — one expensive scene per closed window.`
      : `  Ordering is broken on ${unexplainedResets} scene(s) with no rollup to explain it: something\n  before the verbatim tail is moving when it should not be.`,
  );
  console.log(
    everEligible
      ? `  A shared prefix reaches the ${MIN_CACHEABLE_TOKENS}-token minimum, so a cache hit is possible.`
      : `  The widest shared prefix is ${widestShared} tokens against a ${MIN_CACHEABLE_TOKENS}-token minimum.\n  On this story, at this length, no cache can hit whatever the ordering does — that is the\n  model's threshold, not a fault in the assembly.`,
  );
  console.log(
    live === null
      ? '\n  (Sizes are the assembler’s 4-chars-per-token estimate. Re-run with --count-tokens for real ones.)\n'
      : `\n  (Sizes are ${WRITER_MODEL} countTokens figures.)\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
