/**
 * The assembled-prompt debug view.
 *
 * ADR 0008's own measurement showed why this has to exist: placing the volatile tail right after
 * the header instead of last dropped the cache-hit fraction from 93% to 85% for that call, and
 * flipping the order back does not recover it on the very next scene — the prompt is still being
 * prefix-compared against the wrongly-ordered bytes already sent. An ordering mistake costs real
 * money, persists for an extra scene, and is completely invisible in the output prose. The only
 * way to catch it is to look at the boundaries.
 *
 * So this renders what issue #40's definition of done asks to be inspectable: the cached header,
 * the cached digest hierarchy, the verbatim tail and the volatile tail, in payload order, with
 * their cache mechanism and size — plus which eviction groups survived the volatile-tail budget.
 */

import type { AssembledPrompt } from '../assembler/context-assembler';
import type { CompiledScene } from './compile-scene';

const RULE = '='.repeat(78);

export interface DebugViewOptions {
  /** Include each segment's full text, not just its boundary and size. */
  readonly verbose?: boolean;
}

export function renderPromptDebugView(
  assembled: AssembledPrompt,
  options: DebugViewOptions = {},
): string {
  const lines: string[] = [RULE, 'ASSEMBLED PROMPT — payload order, coarsest to most volatile', RULE];

  for (const [index, part] of assembled.segments.entries()) {
    lines.push(
      `${index + 1}. ${part.name}`,
      `   cache: ${cacheLabel(part.cache)}`,
      `   volatility: ${part.volatility}`,
      `   size: ~${part.estimated_tokens} tokens (${part.text.length} chars)`,
    );
    if (options.verbose === true && part.text !== '') {
      lines.push('   ---', indent(part.text), '   ---');
    }
    lines.push('');
  }

  const cacheable = assembled.segments
    .filter((part) => part.cache !== 'none')
    .reduce((total, part) => total + part.estimated_tokens, 0);
  const fraction =
    assembled.estimated_tokens === 0 ? 0 : Math.round((cacheable / assembled.estimated_tokens) * 100);

  lines.push(
    `TOTAL ~${assembled.estimated_tokens} tokens; ~${cacheable} of them in a cacheable prefix (${fraction}%).`,
    'The real figure is usageMetadata.cachedContentTokenCount, logged per call — this is an',
    'estimate from a 4-chars-per-token approximation, not a billing number.',
    '',
    'VOLATILE-TAIL EVICTION ORDER (ADR 0008 §6 — the mandatory core is never dropped):',
  );

  for (const group of assembled.tail_groups) {
    const state = group.text === '' ? 'empty' : group.included ? 'included' : 'DROPPED';
    lines.push(`  ${group.priority}. ${group.name} — ${state} (~${group.estimated_tokens} tokens)`);
  }

  if (assembled.diagnostics.length > 0) {
    lines.push('', 'ASSEMBLY DIAGNOSTICS:');
    for (const diagnostic of assembled.diagnostics) {
      lines.push(`  [${diagnostic.type}] ${diagnostic.detail}`);
    }
  }

  return lines.join('\n');
}

/** The whole compile: prompt boundaries, calls made, findings, and what came back. */
export function renderCompiledSceneReport(
  compiled: CompiledScene,
  options: DebugViewOptions = {},
): string {
  const lines = [renderPromptDebugView(compiled.assembled, options), '', RULE, 'CALLS', RULE];

  for (const call of compiled.calls) {
    lines.push(
      `  ${call.purpose} — ${call.model} — finish: ${call.finish_reason} — prompt ${call.prompt_tokens} / output ${call.output_tokens} / cached ${call.cached_tokens}`,
    );
  }

  lines.push('', RULE, 'RE-ANCHORING BANDS', RULE);
  for (const decision of compiled.reanchoring) {
    const gap =
      decision.scenes_since_last_touch === null
        ? 'never touched'
        : `${decision.scenes_since_last_touch} scenes`;
    lines.push(`  ${decision.name} (${decision.centrality}, ${gap}) -> ${decision.band}`);
  }

  lines.push('', RULE, 'SCENE DIGEST', RULE, JSON.stringify(compiled.digest, null, 2));

  lines.push('', RULE, 'DIAGNOSTICS', RULE);
  if (compiled.diagnostics.length === 0) {
    lines.push('  (none)');
  }
  for (const diagnostic of compiled.diagnostics) {
    lines.push(`  [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
  }

  return lines.join('\n');
}

function cacheLabel(mechanism: 'explicit' | 'implicit' | 'none'): string {
  switch (mechanism) {
    case 'explicit':
      return 'explicit CachedContent (immutable — header only)';
    case 'implicit':
      return 'implicit prefix cache (append-only)';
    case 'none':
      return 'uncached';
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `   ${line}`)
    .join('\n');
}
