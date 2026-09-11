import { describe, expect, it } from 'vitest';
import { readFixturePackage } from '@/fixtures/load';
import { parseVoiceCard } from '@/voice/voice-card';
import { walkPlantObligations } from '@/plants/obligation-walk';
import { replayTo } from '@/writer/run-state';
import {
  MIN_THINKING_RESERVE_TOKENS,
  compileScene,
  maxOutputTokensFor,
} from '@/writer/compile-scene';
import { clientFor, readRecordedFixture } from '@/writer/recorded-fixture';
import { renderCompiledSceneReport } from '@/writer/debug-view';
import {
  FALLBACK_MODEL,
  WRITER_MODEL,
  type FinishReason,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from '@/writer/model-client';
import { scenesInOrder, type SceneCard } from '@/schema/story-package';
import { scene as sceneCard } from './helpers';

/** A client that hands back a scripted sequence regardless of what it is asked. */
class ScriptedClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private readonly queue: ModelResponse[];

  constructor(queue: ModelResponse[]) {
    this.queue = [...queue];
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next === undefined) throw new Error('ScriptedClient ran out of responses');
    return next;
  }
}

function response(
  text: string,
  finish: FinishReason = 'STOP',
  model: string = WRITER_MODEL,
): ModelResponse {
  return {
    text,
    finish_reason: finish,
    model,
    usage: { prompt_tokens: 0, output_tokens: 0, cached_tokens: 0, thoughts_tokens: 0 },
  };
}

const RECORDINGS = [
  { fixture: 'cinderella', recording: 'cinderella-scene-13' },
  { fixture: 'a-christmas-carol', recording: 'a-christmas-carol-scene-08' },
] as const;

async function setUp(fixture: string, recordingName: string) {
  const pkg = await readFixturePackage(fixture);
  const recording = await readRecordedFixture(recordingName);
  const walk = walkPlantObligations(pkg);
  const state = await replayTo(pkg, recording.target_scene_id, recording.prior_digests, {
    window: recording.window,
  });
  const scene = scenesInOrder(pkg).find(
    (card) => card.id === recording.target_scene_id,
  ) as SceneCard;

  const base = {
    pkg,
    scene,
    model: state.model,
    voiceCard: parseVoiceCard(pkg.voice_card),
    hierarchy: state.hierarchy,
    ledger: state.ledger,
    plantWalk: walk,
    imageryHistory: state.imageryHistory,
    previousParagraph: recording.previous_paragraph,
    occasion: 'read_time' as const,
  };

  return { pkg, recording, walk, state, scene, base };
}

describe.each(RECORDINGS)('compiling $fixture end to end', ({ fixture, recording: name }) => {
  it('accepts the Story Package before spending a token', async () => {
    const { walk } = await setUp(fixture, name);
    // ADR 0004 decision 4: all three errors are statically checkable from Scene Cards alone.
    expect(walk.errors).toEqual([]);
  });

  it('compiles the recorded scene and returns a schema-valid digest', async () => {
    const { recording, base } = await setUp(fixture, name);
    const compiled = await compileScene({ ...base, client: clientFor(recording) });

    expect(compiled.scene_id).toBe(recording.target_scene_id);
    expect(compiled.prose.length).toBeGreaterThan(200);
    expect(compiled.digest.event_summary).not.toBe('');
    expect(compiled.digest.closing_situation).not.toBe('');
    expect(compiled.calls).toHaveLength(1);
    expect(compiled.calls[0]?.model).toBe(WRITER_MODEL);
  });

  it('passes the writer s state updates through ticket 1 s validator without a rejection', async () => {
    const { recording, base, state, scene } = await setUp(fixture, name);
    const compiled = await compileScene({ ...base, client: clientFor(recording) });
    const validation = state.commitWriterUpdates(
      scene,
      compiled.response.state_updates,
      'read_time',
    );

    expect(validation.verdicts.map((verdict) => verdict.outcome)).not.toContain('rejected');
    expect(validation.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  });

  it('satisfies the variance contract and closes what it owed', async () => {
    const { recording, base } = await setUp(fixture, name);
    const compiled = await compileScene({ ...base, client: clientFor(recording) });

    const blocking = compiled.findings.filter(
      (finding) => finding.code !== 'beat_unsatisfied',
    );
    expect(blocking).toEqual([]);
  });

  it('assembles all four segments in payload order, header first and volatile tail last', async () => {
    const { recording, base } = await setUp(fixture, name);
    const compiled = await compileScene({ ...base, client: clientFor(recording) });
    const { segments, header, volatile_tail: tail, verbatim_tail: verbatim } = compiled.assembled;

    expect(segments.map((part) => part.cache)).toEqual(['explicit', 'implicit', 'none', 'none']);
    for (const part of segments) expect(part.estimated_tokens).toBeGreaterThan(0);
    expect(header.text).toContain('You are the performance engine');
    expect(verbatim.text).toContain('PREVIOUS SCENE ENDED');
    expect(tail.text).toContain(`SCENE CARD — ${recording.target_scene_id}`);
  });

  it('sends the header as systemInstruction and never repeats it in the body', async () => {
    const { recording, base } = await setUp(fixture, name);
    const client = clientFor(recording);
    const compiled = await compileScene({ ...base, client });

    const request = client.requests[0]!;
    expect(request.systemInstruction).toBe(compiled.assembled.header.text);
    expect(request.contents).not.toContain('You are the performance engine');
    expect(request.contents).toContain(`SCENE CARD — ${recording.target_scene_id}`);
  });

  it('renders a debug view showing the cache boundaries and eviction order', async () => {
    const { recording, base } = await setUp(fixture, name);
    const compiled = await compileScene({ ...base, client: clientFor(recording) });
    const report = renderCompiledSceneReport(compiled);

    expect(report).toContain('explicit CachedContent');
    expect(report).toContain('implicit prefix cache (append-only)');
    expect(report).toContain('VOLATILE-TAIL EVICTION ORDER');
    expect(report).toContain('RE-ANCHORING BANDS');
  });
});

describe('the digest hierarchy at the replayed scene', () => {
  it('reaches scene 13 of Cinderella with exactly three Chapter Digests open', async () => {
    const { state } = await setUp('cinderella', 'cinderella-scene-13');
    // Twelve scenes at W=4: three level-0 rollups, nothing left loose at level 0.
    const open = state.hierarchy.inPayloadOrder();
    expect(open).toHaveLength(3);
    expect(open.every((entry) => entry.level === 1)).toBe(true);
    expect(open[0]?.scene_orders).toEqual([1, 2, 3, 4]);
  });

  it('reaches scene 8 of the Carol with one Chapter Digest and three loose Scene Digests', async () => {
    const { state } = await setUp('a-christmas-carol', 'a-christmas-carol-scene-08');
    const open = state.hierarchy.inPayloadOrder();
    expect(open.map((entry) => entry.level)).toEqual([1, 0, 0, 0]);
  });
});

describe('failure paths (ADR 0012 decisions 5 and 6)', () => {
  const truncatedAfterProse =
    '{"prose":"She opened the door, and the rain came in with her.","scene_digest":{"event_summary":"she op';

  const fallbackBody = JSON.stringify({
    scene_digest: {
      event_summary: 'She came in out of the rain.',
      entities_on_stage: [],
      facts_revealed: [],
      plants_opened: [],
      payoffs_closed: [],
      imagery_signature: [],
      closing_situation: 'She is inside, and wet.',
      reanchor_used: [],
    },
    state_updates: { updates: [], new_relationships: [], new_character_knowledge: [] },
  });

  it('salvages prose and recovers the digest through the fallback call', async () => {
    const { base } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([
      response(truncatedAfterProse, 'MAX_TOKENS'),
      response(fallbackBody, 'STOP', FALLBACK_MODEL),
    ]);

    const compiled = await compileScene({ ...base, client });

    expect(compiled.prose).toBe('She opened the door, and the rain came in with her.');
    expect(compiled.digest.event_summary).toBe('She came in out of the rain.');
    expect(compiled.calls.map((call) => call.purpose)).toEqual(['writer', 'digest_fallback']);
    expect(compiled.calls[1]?.model).toBe(FALLBACK_MODEL);
    // info, not error: full recovery succeeded and nothing had to be guessed.
    const truncation = compiled.diagnostics.find((entry) => entry.code === 'truncated_scene');
    expect(truncation?.severity).toBe('info');
  });

  it('retries the whole scene when the cut landed inside prose', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([
      response('{"prose":"She opened the door and', 'MAX_TOKENS'),
      response(JSON.stringify(recording.response)),
    ]);

    const compiled = await compileScene({ ...base, client });

    expect(compiled.calls.map((call) => call.purpose)).toEqual(['writer', 'writer_retry']);
    expect(client.requests[1]?.maxOutputTokens).toBeGreaterThan(client.requests[0]!.maxOutputTokens);
    expect(client.requests[1]?.contents).toContain('more concise');
    expect(compiled.prose).toContain('The elder sister sat first');
  });

  it('retries RECITATION once with a paraphrase instruction, then flags it', async () => {
    const { base } = await setUp('a-christmas-carol', 'a-christmas-carol-scene-08');
    const client = new ScriptedClient([response('', 'RECITATION'), response('', 'RECITATION')]);

    const compiled = await compileScene({ ...base, client });

    expect(client.requests[1]?.contents).toContain('Paraphrase and reinterpret');
    expect(compiled.diagnostics.map((entry) => entry.code)).toContain('recitation_flagged');
    expect(compiled.diagnostics.map((entry) => entry.code)).toContain('scene_generation_failed');
  });

  it('retries a content filter once with a fiction-framing reminder', async () => {
    const { base } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([response('', 'SAFETY'), response('', 'SAFETY')]);

    const compiled = await compileScene({ ...base, client });

    expect(client.requests[1]?.contents).toContain('literary narrative content');
    expect(compiled.diagnostics.map((entry) => entry.code)).toContain('content_filtered');
  });

  it('retries a malformed response with the identical prompt', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([
      response('not json at all', 'MALFORMED_RESPONSE'),
      response(JSON.stringify(recording.response)),
    ]);

    await compileScene({ ...base, client });
    expect(client.requests[1]?.contents).toBe(client.requests[0]?.contents);
  });

  it('builds a conservative digest when everything fails, and never invents an event', async () => {
    const { base } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([response('', 'OTHER'), response('', 'OTHER')]);

    const compiled = await compileScene({ ...base, client });

    expect(compiled.digest.facts_revealed).toEqual([]);
    expect(compiled.digest.plants_opened).toEqual([]);
    expect(compiled.digest.payoffs_closed).toEqual([]);
    // closing_situation is copied forward with a note: the situation genuinely has not moved.
    expect(compiled.digest.closing_situation).toContain('could not be generated');
    expect(compiled.prose).toContain('could not be generated');
    const failure = compiled.diagnostics.find((entry) => entry.code === 'scene_generation_failed');
    expect(failure?.severity).toBe('error');
  });

  it('retries a response that finished cleanly but does not satisfy the schema', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    // Valid JSON, `STOP`, and missing a required digest field. `parseWriterResponse` already
    // treats this exactly like unparseable output, so the retry shape has to as well — before,
    // a `STOP` that failed validation got no retry at all and fell straight to salvage.
    const client = new ScriptedClient([
      response(JSON.stringify({ prose: 'a scene', scene_digest: { event_summary: 'x' } })),
      response(JSON.stringify(recording.response)),
    ]);

    const compiled = await compileScene({ ...base, client });

    expect(client.requests).toHaveLength(2);
    expect(compiled.calls.map((call) => call.purpose)).toEqual(['writer', 'writer_retry']);
    expect(compiled.digest.event_summary).not.toBe('');
  });

  it('does not retry a response that parsed cleanly', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([response(JSON.stringify(recording.response))]);
    const compiled = await compileScene({ ...base, client });
    expect(compiled.calls).toHaveLength(1);
  });
});

describe('the one bounded retry on an invariant miss (issue #61)', () => {
  /**
   * The recorded response with one invariant dropped.
   *
   * `scene_13_the_fitting` declares `pays_off: cinderella_kept_second_slipper` and the recording
   * duly reports it in `payoffs_closed`. Emptying that field is a scene that came back missing
   * something its card required — a `finishReason` of `STOP` says nothing about it.
   */
  function missingItsPayoff(recording: { response: Record<string, unknown> }): string {
    const digest = recording.response['scene_digest'] as Record<string, unknown>;
    return JSON.stringify({
      ...recording.response,
      scene_digest: { ...digest, payoffs_closed: [] },
    });
  }

  it('retries once, restating what was missed rather than re-sending the prompt', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([
      response(missingItsPayoff(recording)),
      response(JSON.stringify(recording.response)),
    ]);

    const compiled = await compileScene({ ...base, client });

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.contents).toContain(
      'did not satisfy everything the Scene Card requires',
    );
    expect(client.requests[1]?.contents).toContain('cinderella_kept_second_slipper');
    expect(compiled.digest.payoffs_closed).toEqual(['cinderella_kept_second_slipper']);
    expect(compiled.diagnostics.map((entry) => entry.code)).toContain('invariant_retry_accepted');
    expect(compiled.diagnostics.map((entry) => entry.code)).not.toContain('payoff_not_closed');
  });

  it('keeps the first attempt when the retry does no better', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    const missed = missingItsPayoff(recording);
    const client = new ScriptedClient([response(missed), response(missed)]);

    const compiled = await compileScene({ ...base, client });

    expect(client.requests).toHaveLength(2);
    const codes = compiled.diagnostics.map((entry) => entry.code);
    expect(codes).toContain('invariant_retry_discarded');
    // The miss is still logged under its own code — accept-and-log, per ADR 0006 §3.
    expect(codes).toContain('payoff_not_closed');
  });

  it('never retries at author-time — the author is present and can fix the card', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([response(missingItsPayoff(recording))]);

    const compiled = await compileScene({ ...base, client, occasion: 'author_time' });

    expect(client.requests).toHaveLength(1);
    expect(compiled.diagnostics.map((entry) => entry.code)).toContain('payoff_not_closed');
  });

  it('spends at most one retry per scene, shared with the finish-reason retry', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    // A malformed first attempt spends the budget; the retry that comes back missing its payoff
    // does not get a second one.
    const client = new ScriptedClient([
      response('not json at all', 'MALFORMED_RESPONSE'),
      response(missingItsPayoff(recording)),
    ]);

    const compiled = await compileScene({ ...base, client });

    expect(client.requests).toHaveLength(2);
    expect(compiled.calls.filter((call) => call.purpose === 'writer_retry')).toHaveLength(1);
    expect(compiled.diagnostics.map((entry) => entry.code)).toContain('payoff_not_closed');
  });

  it('does not retry a scene that satisfied its card', async () => {
    const { base, recording } = await setUp('cinderella', 'cinderella-scene-13');
    const client = new ScriptedClient([response(JSON.stringify(recording.response))]);
    await compileScene({ ...base, client });
    expect(client.requests).toHaveLength(1);
  });
});

describe('the output-token budget (issue #49)', () => {
  it('reserves room to think that a short scene does not lose', () => {
    // Thinking scales with how tangled the scene is, not with its word count: a 200-word scene
    // measured 897 thinking tokens against a cap that used to be 934 for the whole response.
    const short = maxOutputTokensFor(sceneCard({ length_budget: 200 }));
    const long = maxOutputTokensFor(sceneCard({ length_budget: 500 }));

    expect(short).toBeGreaterThan(200 * 2 * 1.4 + MIN_THINKING_RESERVE_TOKENS - 1);
    expect(long).toBeGreaterThan(short);
    // Every thinking figure the first live run measured (897–2,633) fits, on the shortest scene.
    expect(short - Math.ceil(200 * 2 * 1.4)).toBeGreaterThanOrEqual(2_633);
  });

  it('lets the proportional reserve take over once a scene is long enough to need it', () => {
    const huge = maxOutputTokensFor(sceneCard({ length_budget: 5_000 }));
    const proseAndTail = Math.ceil(5_000 * 2 * 1.4);
    expect(huge - proseAndTail).toBeGreaterThan(MIN_THINKING_RESERVE_TOKENS);
  });
});
