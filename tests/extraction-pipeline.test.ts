/**
 * Tests for the extraction pipeline's deterministic parts (issue #117).
 *
 * Every LLM pass is covered through a stub `ModelClient`, so the whole chain — windowing,
 * gleaning, reconcile, chronology repair, seed assembly, span resolution — runs end to end
 * without a network call and without pretending a recorded model response is a measurement. The
 * numbers that are actually *about* extraction quality come from a live run and live in the
 * ticket's report, not here; what these assert is that the machinery around them is correct.
 */

import { describe, expect, it } from 'vitest';

import { ExtractionModel } from '@/extraction/call';
import { extractStoryPackage } from '@/extraction/pipeline';
import { repairOrder } from '@/extraction/pass-chronology';
import { dedupeBySpan, extractEvents } from '@/extraction/pass-events';
import { foldProposals, isSuspiciousMerge, reconcile } from '@/extraction/pass-reconcile';
import { gateG0 } from '@/extraction/scoring/gates';
import { eventReferencedIds, invention } from '@/extraction/scoring/score';
import { FABULA_BLOCK } from '@/schema/fabula';
import { importSummary } from '@/authoring/transfer';
import { loadGroundTruth, narratedOutOfOrder } from '@/extraction/scoring/ground-truth';
import { groundingReport, normalizeWhitespace, resolveQuote } from '@/extraction/spans';
import { countWords, manifestFor, sliceLines } from '@/extraction/sources';
import { paragraphsOf, windowsOf } from '@/extraction/windows';
import type { LoadedSource } from '@/extraction/sources';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';

const PROSE = [
  'Once there was a gentleman who married a proud and haughty woman.',
  '',
  'The stepmother sent Cinderella to sleep in the chimney-corner among the cinders.',
  '',
  'Long afterwards, the King\'s son gave a ball, and all persons of fashion were invited.',
].join('\n');

describe('windowing', () => {
  it('keeps paragraph offsets that index back into the source', () => {
    const paragraphs = paragraphsOf(PROSE);
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) {
      expect(PROSE.slice(paragraph.start, paragraph.end)).toBe(paragraph.text);
    }
  });

  it('covers every paragraph, and overlaps by one so a seam is read twice', () => {
    const windows = windowsOf(PROSE, { target_words: 20, overlap_paragraphs: 1 });
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]!.first_paragraph).toBe(0);
    expect(windows.at(-1)!.last_paragraph).toBe(2);
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i]!.first_paragraph).toBe(windows[i - 1]!.last_paragraph);
    }
  });

  it('advances without overlap rather than looping when a window is one paragraph', () => {
    // The overlap is best-effort: a window that is a single paragraph cannot both overlap by one
    // and make progress, and progress wins.
    const windows = windowsOf(PROSE, { target_words: 8, overlap_paragraphs: 1 });
    expect(windows).toHaveLength(3);
    expect(windows.map((window) => window.first_paragraph)).toEqual([0, 1, 2]);
  });

  it('terminates on a single paragraph longer than the target', () => {
    const windows = windowsOf('one very long paragraph indeed', {
      target_words: 2,
      overlap_paragraphs: 1,
    });
    expect(windows).toHaveLength(1);
  });
});

describe('span grounding', () => {
  it('resolves an exact quote to offsets the source agrees with', () => {
    const span = resolveQuote(PROSE, 'proud and haughty woman');
    expect(span?.resolution).toBe('exact');
    expect(PROSE.slice(span!.start, span!.end)).toBe('proud and haughty woman');
  });

  it('resolves a quote across a hard line break, and says it normalized', () => {
    const wrapped = 'she was sent to sleep in the\nchimney-corner among the cinders';
    const span = resolveQuote(wrapped, 'sleep in the chimney-corner');
    expect(span?.resolution).toBe('normalized');
    expect(normalizeWhitespace(wrapped.slice(span!.start, span!.end))).toBe(
      'sleep in the chimney-corner',
    );
  });

  it('refuses a quote the source does not contain — the whole point of the check', () => {
    expect(resolveQuote(PROSE, 'the mice sewed her a dress')).toBeNull();
  });

  it('prefers the occurrence inside the window the claim came from', () => {
    const repeated = 'a ball was given. ' + 'x'.repeat(50) + ' a ball was given.';
    const late = resolveQuote(repeated, 'a ball was given', { start: 40, end: repeated.length });
    expect(late!.start).toBeGreaterThan(40);
  });

  it('reports ungrounded claims rather than dropping them', () => {
    const report = groundingReport([
      { subject: 'a', claim: 'c', quote: 'q', span: { start: 0, end: 1, text: 'O', resolution: 'exact' } },
      { subject: 'b', claim: 'c', quote: 'q', span: null },
    ]);
    expect(report.grounded_rate).toBe(0.5);
    expect(report.ungrounded.map((entry) => entry.subject)).toEqual(['b']);
  });
});

describe('reconcile guards', () => {
  it('folds proposals of the same entity across windows', () => {
    const folded = foldProposals([
      { kind: 'character', name: 'Cinderella', aliases: [], note: 'a', quote: '', window: 0 },
      { kind: 'character', name: 'cinderella', aliases: ['Cinderwench'], note: 'b', quote: '', window: 1 },
      { kind: 'location', name: 'Cinderella', aliases: [], note: 'c', quote: '', window: 1 },
    ]);
    expect(folded).toHaveLength(2);
    expect(folded[0]!.windows).toEqual([0, 1]);
    expect(folded[0]!.aliases).toEqual(['Cinderwench']);
  });

  it('flags a merge whose names share no word — the over-merge signal of research §2.2', () => {
    expect(isSuspiciousMerge(['Ebenezer Scrooge', 'Scrooge'])).toBe(false);
    expect(isSuspiciousMerge(['the elder stepsister', 'Miss Charlotte'])).toBe(true);
    expect(isSuspiciousMerge(['Cinderella'])).toBe(false);
  });
});

describe('reconcile, batched', () => {
  /** Answers entity batches from a lookup table; everything else comes back empty. */
  class AssignmentClient implements ModelClient {
    batches: string[][] = [];
    constructor(private readonly table: Record<string, { id: string; name?: string }>) {}
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const names = [...request.contents.matchAll(/^- \[\w+\] ([^(—\n]+)/gm)].map((match) =>
        match[1]!.trim(),
      );
      this.batches.push(names);
      const assignments = names
        .filter((name) => this.table[name] !== undefined)
        .map((name) => ({
          proposal: name,
          entity_id: this.table[name]!.id,
          canonical_name: this.table[name]!.name ?? name,
        }));
      return {
        text: JSON.stringify({ assignments }),
        finish_reason: 'STOP',
        model: 'stub-model',
        usage: { prompt_tokens: 1, output_tokens: 1, cached_tokens: 0, thoughts_tokens: 0 },
      };
    }
  }

  const proposal = (kind: 'character' | 'location' | 'object', name: string, window = 0) => ({
    kind,
    name,
    aliases: [],
    note: '',
    quote: '',
    window,
  });

  it('splits proposals into bounded batches instead of one unbounded call', async () => {
    const client = new AssignmentClient({});
    const model = new ExtractionModel(client, 'stub-model');
    const proposals = Array.from({ length: 7 }, (_, index) =>
      proposal('character', `Person ${index}`, index),
    );
    await reconcile(model, proposals, [], { batchSize: 3 });
    expect(client.batches.map((batch) => batch.length)).toEqual([3, 3, 1]);
  });

  it('gives a proposal the model never answered for its own row rather than losing it', async () => {
    const client = new AssignmentClient({ Scrooge: { id: 'char_scrooge' } });
    const model = new ExtractionModel(client, 'stub-model');
    const result = await reconcile(
      model,
      [proposal('character', 'Scrooge'), proposal('character', 'Fezziwig')],
      [],
    );
    expect(result.entities.map((entity) => entity.id).sort()).toEqual([
      'char_fezziwig',
      'char_scrooge',
    ]);
    expect(result.dropped_proposals).toEqual([]);
  });

  it('refuses a cross-kind assignment rather than putting a location in the character table', async () => {
    const client = new AssignmentClient({
      Scrooge: { id: 'char_scrooge' },
      // The model tries to fold a location onto the character's id.
      'the counting-house': { id: 'char_scrooge' },
    });
    const model = new ExtractionModel(client, 'stub-model');
    const result = await reconcile(
      model,
      [proposal('character', 'Scrooge'), proposal('location', 'the counting-house')],
      [],
    );
    const location = result.entities.find((entity) => entity.kind === 'location');
    expect(location).toBeDefined();
    expect(location!.id).not.toBe('char_scrooge');
    expect(result.entities.find((entity) => entity.id === 'char_scrooge')!.merged_from).toEqual([
      'Scrooge',
    ]);
  });

  it('records a merge and flags it when the welded names share no word', async () => {
    const client = new AssignmentClient({
      Scrooge: { id: 'char_scrooge', name: 'Ebenezer Scrooge' },
      'Ebenezer Scrooge': { id: 'char_scrooge', name: 'Ebenezer Scrooge' },
      Fan: { id: 'char_fan', name: 'Fan' },
      Belle: { id: 'char_fan', name: 'Fan' },
    });
    const model = new ExtractionModel(client, 'stub-model');
    const result = await reconcile(
      model,
      [
        proposal('character', 'Scrooge'),
        proposal('character', 'Ebenezer Scrooge'),
        proposal('character', 'Fan'),
        proposal('character', 'Belle'),
      ],
      [],
    );
    expect(result.merges).toHaveLength(2);
    expect(result.suspicious_merges.map((merge) => merge.id)).toEqual(['char_fan']);
  });

  it('survives a failed batch, counting it instead of losing the run', async () => {
    class FailingClient implements ModelClient {
      async generate(): Promise<ModelResponse> {
        return {
          text: 'not json',
          finish_reason: 'MAX_TOKENS',
          model: 'stub-model',
          usage: { prompt_tokens: 1, output_tokens: 1, cached_tokens: 0, thoughts_tokens: 1 },
        };
      }
    }
    const model = new ExtractionModel(new FailingClient(), 'stub-model');
    const result = await reconcile(model, [proposal('character', 'Scrooge')], []);
    expect(result.failed_batches).toBe(1);
    // The run continues with the no-merge answer, which is the safe direction.
    expect(result.entities.map((entity) => entity.id)).toEqual(['char_scrooge']);
  });
});

describe('chronology repair', () => {
  it('keeps a valid ordering untouched', () => {
    const repaired = repairOrder(['b', 'a'], ['a', 'b']);
    expect(repaired.order).toEqual(['b', 'a']);
    expect(repaired.appended).toBe(0);
    expect(repaired.rejected).toBe(0);
  });

  it('re-inserts omitted ids in narrated order and counts the repair', () => {
    const repaired = repairOrder(['c'], ['a', 'b', 'c']);
    expect(repaired.order).toEqual(['c', 'a', 'b']);
    expect(repaired.appended).toBe(2);
  });

  it('rejects invented and duplicated ids', () => {
    const repaired = repairOrder(['a', 'a', 'zz'], ['a', 'b']);
    expect(repaired.order).toEqual(['a', 'b']);
    expect(repaired.rejected).toBe(2);
  });
});

describe('window-seam deduplication', () => {
  it('drops a second event quoting the identical span', () => {
    const events = [
      { id: 'ev_1', summary: 'the clock strikes twelve' },
      { id: 'ev_2', summary: 'midnight sounds' },
      { id: 'ev_3', summary: 'she flees' },
    ];
    const spans: Record<string, { start: number; end: number } | null> = {
      ev_1: { start: 10, end: 20 },
      ev_2: { start: 10, end: 20 },
      ev_3: { start: 40, end: 50 },
    };
    const { kept, removed } = dedupeBySpan(events, (event) => spans[event.id] ?? null);
    expect(kept.map((event) => event.id)).toEqual(['ev_1', 'ev_3']);
    expect(removed.map((event) => event.id)).toEqual(['ev_2']);
  });
});

describe('sources', () => {
  it('slices an inclusive 1-based line range', () => {
    expect(sliceLines('a\nb\nc\nd', 2, 3)).toBe('b\nc');
  });

  it('counts words the way the research file does', () => {
    expect(countWords('  two  words ')).toBe(2);
  });
});

describe('ground truth', () => {
  it('flattens the fixture beats into a chronologically keyed event list', async () => {
    const truth = await loadGroundTruth('cinderella');
    expect(truth.events.length).toBeGreaterThan(30);
    // Lang's Cinderella is linear: narrated order and Fabula order agree everywhere.
    for (const a of truth.events) {
      for (const b of truth.events) {
        expect(narratedOutOfOrder(a, b)).toBe(false);
      }
    }
  });

  it('puts the Carol\'s flashbacks before its present and its visions after', async () => {
    const truth = await loadGroundTruth('a-christmas-carol');
    const school = truth.events.find((event) => event.scene_id === 'scene_04_the_lonely_school')!;
    const countingHouse = truth.events.find((event) => event.scene_id === 'scene_01_counting_house')!;
    const grave = truth.events.find((event) => event.scene_id === 'scene_17_the_name_on_the_stone')!;

    expect(school.chronological_key).toBeLessThan(countingHouse.chronological_key);
    expect(school.narrated_key).toBeGreaterThan(countingHouse.narrated_key);
    expect(narratedOutOfOrder(school, countingHouse)).toBe(true);

    expect(grave.chronological_key).toBeGreaterThan(countingHouse.chronological_key);
    expect(narratedOutOfOrder(grave, countingHouse)).toBe(false);
  });

  it('covers every fixture scene, or refuses to score a subset silently', async () => {
    for (const storyId of ['cinderella', 'a-christmas-carol']) {
      const truth = await loadGroundTruth(storyId);
      const scenes = new Set(truth.events.map((event) => event.scene_id));
      expect(scenes.size).toBe(truth.package.scene_cards.length);
    }
  });
});

// --- End to end, against a stub client ---------------------------------------------------

class StubClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      text: JSON.stringify(this.answer(request)),
      finish_reason: 'STOP',
      model: 'stub-model',
      usage: { prompt_tokens: 10, output_tokens: 10, cached_tokens: 0, thoughts_tokens: 0 },
    };
  }

  private answer(request: ModelRequest): unknown {
    const properties = Object.keys(
      (request.responseJsonSchema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    if (properties.includes('entities') && properties.includes('relationships')) {
      // The gleaning re-ask gets nothing back, which is how the loop is supposed to terminate.
      if (request.contents.includes('MANY entities and relationships were missed')) {
        return { entities: [], relationships: [] };
      }
      return {
        entities: [
          {
            kind: 'character',
            name: 'Cinderella',
            aliases: ['Cinderwench'],
            note: 'the daughter',
            quote: 'sleep in the chimney-corner',
          },
          {
            kind: 'location',
            name: 'the chimney-corner',
            aliases: [],
            note: 'by the hearth',
            quote: 'the chimney-corner among the cinders',
          },
        ],
        relationships: [
          {
            from: 'the stepmother',
            to: 'Cinderella',
            kind: 'stepmother_of',
            sentiment: 'resents',
            quote: 'The stepmother sent Cinderella',
          },
        ],
      };
    }
    if (properties.includes('assignments')) {
      return {
        assignments: [
          { proposal: 'Cinderella', entity_id: 'char_cinderella', canonical_name: 'Cinderella' },
          {
            proposal: 'the chimney-corner',
            entity_id: 'loc_chimney_corner',
            canonical_name: 'the chimney-corner',
          },
        ],
      };
    }
    if (properties.includes('relationships')) {
      // Points at an id no row carries, so the drop path is exercised.
      return {
        relationships: [
          {
            from_id: 'char_stepmother',
            to_id: 'char_cinderella',
            kind: 'stepmother_of',
            sentiment: 'resents',
            from_proposal: 0,
          },
        ],
      };
    }
    if (properties.includes('events')) {
      return {
        events: [
          {
            summary: 'the stepmother sends Cinderella to the chimney-corner',
            quote: 'sent Cinderella to sleep in the chimney-corner',
            story_time: 'present',
            time_anchor: '',
            participants: ['char_cinderella'],
            location_id: 'loc_chimney_corner',
            state_updates: [
              {
                entity_id: 'char_cinderella',
                column: 'location_id',
                value: 'loc_chimney_corner',
                quote: 'sleep in the chimney-corner',
              },
              {
                entity_id: 'char_nobody',
                column: 'status',
                value: 'invented',
                quote: 'nothing like this is in the text',
              },
            ],
          },
        ],
      };
    }
    if (properties.includes('ordered_event_ids')) {
      return { ordered_event_ids: [] };
    }
    if (properties.includes('rows')) {
      return {
        rows: [
          {
            id: 'char_cinderella',
            location_id: 'loc_chimney_corner',
            status: 'alive',
            goal: null,
            bag: [{ key: 'epithet', value: 'Cinderwench' }],
            quote: 'proud and haughty woman',
          },
        ],
      };
    }
    return {};
  }
}

function stubSource(): LoadedSource {
  return {
    manifest: {
      id: 'cinderella',
      title: 'test',
      edition: 'test edition',
      url: 'https://example.invalid/test.txt',
      cache_file: 'test.txt',
      first_line: 1,
      last_line: 5,
      expected_words: countWords(PROSE),
    },
    text: PROSE,
    words: countWords(PROSE),
    sha256: 'deadbeef',
  };
}

describe('pipeline end to end', () => {
  it('emits a draft package with a populated seed and no Scene Cards', async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
      maxGleanings: 1,
    });

    expect(result.package.scene_cards).toEqual([]);
    expect(result.package.world_model_seed.characters).toHaveLength(1);
    expect(result.package.world_model_seed.characters[0]!.id).toBe('char_cinderella');
    expect(result.package.world_model_seed.characters[0]!.location_id).toBe('loc_chimney_corner');
    expect(result.package.world_model_seed.characters[0]!.bag).toEqual({ epithet: 'Cinderwench' });
    expect(result.package.world_model_seed.locations).toHaveLength(1);
    // The relationship named an id the seed does not carry, so it was dropped rather than
    // emitted as an `unknown_entity` lint error.
    expect(result.package.world_model_seed.relationships).toEqual([]);
  });

  it('records every claim\'s span, and drops a state update naming an unknown entity', async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });

    expect(result.sidecar.grounding.total).toBeGreaterThan(0);
    for (const claim of result.sidecar.claims) {
      if (claim.span === null) continue;
      expect(PROSE.slice(claim.span.start, claim.span.end)).toBe(claim.span.text);
    }
    expect(result.sidecar.diagnostics.dropped_state_updates).toBeGreaterThan(0);
    for (const event of result.sidecar.events) {
      for (const update of event.state_updates) {
        expect(update.entity_id).not.toBe('char_nobody');
      }
    }
  });

  it('keeps objects and locations out of participants, and counts the drops', async () => {
    // Regression for a defect the provisional-projection gate found and a seed-only gate could
    // not: the event pass listed the pumpkin, the wand and the garden as participants, which
    // project into `characters_present` and draw 25 `wrong_entity_table` errors on Cinderella.
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    const characterIds = new Set(
      result.package.world_model_seed.characters.map((row) => row.id),
    );
    for (const event of result.sidecar.events) {
      for (const participant of event.participants) {
        expect(characterIds.has(participant)).toBe(true);
      }
      if (event.location_id !== null) {
        expect(
          result.package.world_model_seed.locations.some((row) => row.id === event.location_id),
        ).toBe(true);
      }
    }
    expect(gateG0(result.package).projected.errors).toEqual([]);
  });

  it('records the model that actually answered, not the one requested', async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'requested-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    expect(result.sidecar.provenance.requested_model).toBe('requested-model');
    expect(result.sidecar.provenance.models_used).toEqual(['stub-model']);
  });

  it('falls back to narrated order when the chronology call returns nothing usable', async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    const narrated = [...result.sidecar.events].sort(
      (a, b) => a.narrated_index - b.narrated_index,
    );
    const chronological = [...result.sidecar.events].sort(
      (a, b) => a.chronological_index - b.chronological_index,
    );
    expect(chronological.map((event) => event.id)).toEqual(narrated.map((event) => event.id));
  });
});

describe('_fabula block — convergence with #119', () => {
  it("carries the event list in #119's block, under #119's field names", async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    const block = (result.package as Record<string, unknown>)[FABULA_BLOCK] as {
      events: Array<Record<string, unknown>>;
      fields_not_recovered: Record<string, string>;
    };

    expect(block).toBeDefined();
    expect(block.events.length).toBe(result.sidecar.events.length);
    for (const field of [
      'id',
      'sequence',
      'summary',
      'location_id',
      'characters_present',
      'beats',
      'pays_off',
      'state_changes',
    ]) {
      expect(block.events[0]).toHaveProperty(field);
    }
    // `sequence` is the 1-based Fabula position, exactly as #119 defines it.
    expect(block.events.map((entry) => entry['sequence'])).toEqual(
      block.events.map((_, index) => index + 1),
    );
  });

  it('names the fields extraction cannot recover instead of filling them with guesses', async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    const block = (result.package as Record<string, unknown>)[FABULA_BLOCK] as {
      events: Array<Record<string, unknown>>;
      fields_not_recovered: Record<string, string>;
    };

    expect(Object.keys(block.fields_not_recovered).sort()).toEqual([
      'caused_by',
      'conceals',
      'dramatic_function',
      'pov',
      'reveals',
    ]);
    for (const field of Object.keys(block.fields_not_recovered)) {
      expect(block.events[0]).not.toHaveProperty(field);
    }
  });

  it("survives the import path's extra-block handling rather than being dropped", async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    const summary = importSummary(result.package);
    expect(summary.extra_blocks).toContain(FABULA_BLOCK);
  });
});

describe('G0', () => {
  it('reports the deliverable failing only on the expected empty scene_cards', async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    const gate = gateG0(result.package);

    expect(gate.deliverable.publishable).toBe(false);
    expect(gate.deliverable.errors.map((error) => error.code)).toContain('schema.too_small');
    expect(gate.deliverable.unexpected_errors).toEqual([]);
  });

  it('lints the projection through the real linter, and passes when references resolve', async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    const gate = gateG0(result.package);

    expect(gate.projected.scene_count).toBeGreaterThan(0);
    expect(gate.projected.errors).toEqual([]);
    expect(gate.projected.passed).toBe(true);
  });

  it('counts the substitutions the projection needed rather than hiding them', async () => {
    const result = await extractStoryPackage(stubSource(), new StubClient(), 'stub-model', {
      windowOptions: { target_words: 8, overlap_paragraphs: 1 },
    });
    const substitutions = gateG0(result.package).projected.substitutions;
    expect(
      substitutions.pov_from_first_participant + substitutions.pov_unavailable,
    ).toBe(gateG0(result.package).projected.scene_count);
  });

  it('catches a dangling seed reference', () => {
    const gate = gateG0({
      schema_version: '1.0',
      package_version: 1,
      story_id: 'x',
      world_model_seed: {
        characters: [
          { id: 'char_a', name: 'A', location_id: 'loc_missing', status: null, goal: null, bag: {} },
        ],
        locations: [{ id: 'loc_real', name: 'Real', bag: {} }],
        objects: [],
        relationships: [],
        character_knowledge: [],
      },
      scene_cards: [],
      voice_card: {},
      metadata: { title: 'x' },
      [FABULA_BLOCK]: {
        events: [
          {
            id: 'ev_1',
            sequence: 1,
            summary: 'something happens',
            location_id: 'loc_real',
            characters_present: ['char_a'],
            beats: ['something happens'],
            state_changes: [],
          },
        ],
      },
    });
    expect(gate.projected.passed).toBe(false);
    expect(gate.projected.errors.map((error) => error.code)).toContain('unknown_entity');
    expect(gate.projected.errors.map((error) => error.path).join(' ')).toContain(
      'world_model_seed.characters.char_a.location_id',
    );
  });

  it('catches an event naming an entity the seed does not carry — which a seed-only gate cannot', () => {
    const gate = gateG0({
      schema_version: '1.0',
      package_version: 1,
      story_id: 'x',
      world_model_seed: {
        characters: [
          { id: 'char_a', name: 'A', location_id: null, status: null, goal: null, bag: {} },
        ],
        locations: [{ id: 'loc_real', name: 'Real', bag: {} }],
        objects: [],
        relationships: [],
        character_knowledge: [],
      },
      scene_cards: [],
      voice_card: {},
      metadata: { title: 'x' },
      [FABULA_BLOCK]: {
        events: [
          {
            id: 'ev_1',
            sequence: 1,
            summary: 'a stranger arrives',
            location_id: 'loc_real',
            characters_present: ['char_a', 'char_ghost'],
            beats: ['a stranger arrives'],
            state_changes: [],
          },
        ],
      },
    });
    expect(gate.projected.passed).toBe(false);
    expect(gate.projected.errors.map((error) => error.message).join(' ')).toContain('char_ghost');
  });

  it('passes the real fixture packages, so the gate is not vacuous', async () => {
    const truth = await loadGroundTruth('cinderella');
    expect(gateG0(truth.package).deliverable.publishable).toBe(true);
  });
});

describe('ExtractionModel bookkeeping', () => {
  it('retries once with a bigger budget, then throws, and logs both attempts', async () => {
    class BadClient implements ModelClient {
      calls = 0;
      budgets: number[] = [];
      async generate(request: ModelRequest): Promise<ModelResponse> {
        this.calls += 1;
        this.budgets.push(request.maxOutputTokens);
        return {
          text: '{"truncated": ',
          finish_reason: 'MAX_TOKENS',
          model: 'stub-model',
          usage: { prompt_tokens: 1, output_tokens: 1, cached_tokens: 0, thoughts_tokens: 0 },
        };
      }
    }
    const client = new BadClient();
    const model = new ExtractionModel(client, 'stub-model');
    const { z } = await import('zod');
    await expect(
      model.json(z.object({ ok: z.boolean() }), {
        pass: 'test',
        label: 'x',
        systemInstruction: '',
        contents: '',
        responseJsonSchema: { type: 'object' },
        maxOutputTokens: 100,
      }),
    ).rejects.toThrow(/unparseable JSON/);
    expect(client.calls).toBe(2);
    expect(client.budgets).toEqual([100, 200]);
    expect(model.calls).toHaveLength(2);
    expect(model.calls.every((call) => call.error !== null)).toBe(true);
  });
});

describe('fabricated events vs ungroundable quotes (#152)', () => {
  it('counts only contradicted events as invention', () => {
    const { fabricated, ungroundable } = invention(
      ['event:ev_0001', 'event:ev_0002', 'character:char_scrooge'],
      ['event:ev_0009'],
    );
    expect(fabricated).toEqual(['ev_0009']);
    expect(ungroundable).toEqual(['ev_0001', 'ev_0002']);
  });

  it('does not count a state_update contradiction as a fabricated event', () => {
    // The exact shape that made A Christmas Carol report 13 fabricated events: its one
    // `contradicts` verdict is on a state_update, not on an event, so invention is empty.
    const { fabricated, ungroundable } = invention(
      ['event:ev_0113', 'event:ev_0358'],
      ['state_update:ev_0358:char_charwoman.location_id'],
    );
    expect(fabricated).toEqual([]);
    expect(ungroundable).toHaveLength(2);
  });

  it('keeps the two populations separate rather than unioning them', () => {
    // An event can be both ungroundable and contradicted; it must not be double-counted away
    // from either row, and the zero-tolerance row must still see it.
    const { fabricated, ungroundable } = invention(['event:ev_0007'], ['event:ev_0007']);
    expect(fabricated).toEqual(['ev_0007']);
    expect(ungroundable).toEqual(['ev_0007']);
  });

  it('dedupes repeated subjects', () => {
    const { fabricated } = invention([], ['event:ev_0004', 'event:ev_0004']);
    expect(fabricated).toEqual(['ev_0004']);
  });

  it('ignores non-event subjects entirely', () => {
    const { fabricated, ungroundable } = invention(
      ['character:char_ali_baba', 'location:loc_court'],
      ['relationship:char_a|char_b|knows'],
    );
    expect(fabricated).toEqual([]);
    expect(ungroundable).toEqual([]);
  });
});

describe('load-bearing rows — §2\'s grain rule (#151)', () => {
  const event = (over: Partial<Parameters<typeof eventReferencedIds>[0][number]> = {}) =>
    ({
      id: 'ev_0001',
      summary: '',
      story_time: 'present' as const,
      time_anchor: '',
      participants: [],
      location_id: null,
      chronological_index: 0,
      narrated_index: 0,
      window: 0,
      span: null,
      quote: '',
      state_updates: [],
      ...over,
    }) as Parameters<typeof eventReferencedIds>[0][number];

  it('counts participants, locations and state-update targets', () => {
    const referenced = eventReferencedIds([
      event({ participants: ['char_scrooge'], location_id: 'loc_counting_house' }),
      event({
        state_updates: [
          { entity_id: 'char_marley', column: 'status', value: 'dead', quote: '', span: null },
        ],
      }),
    ]);
    expect([...referenced].sort()).toEqual(['char_marley', 'char_scrooge', 'loc_counting_house']);
  });

  it('counts a location a state update moves an entity to', () => {
    const referenced = eventReferencedIds([
      event({
        state_updates: [
          { entity_id: 'char_a', column: 'location_id', value: 'loc_school', quote: '', span: null },
        ],
      }),
    ]);
    expect(referenced.has('loc_school')).toBe(true);
  });

  it('does not treat a non-location column value as an entity id', () => {
    const referenced = eventReferencedIds([
      event({
        state_updates: [
          { entity_id: 'char_a', column: 'status', value: 'loc_school', quote: '', span: null },
        ],
      }),
    ]);
    expect(referenced.has('loc_school')).toBe(false);
  });

  it('leaves a row no event mentions out — the case the rule exists for', () => {
    // Cinderella extracts `char_the_king`, `char_six_mice` and friends; the fixture folds them
    // away. §2 calls that a different valid grain, not an invention.
    const referenced = eventReferencedIds([event({ participants: ['char_cinderella'] })]);
    expect(referenced.has('char_the_king')).toBe(false);
    expect(referenced.has('char_cinderella')).toBe(true);
  });

  it('is empty for an empty event list rather than throwing', () => {
    expect(eventReferencedIds([]).size).toBe(0);
  });
});

describe('the held-out fixture is scoreable (#142 wave 2)', () => {
  it('loads a source slice for all three fixtures', async () => {
    // the-machine-stops had a package from #132 phase 2 but no source manifest, so its text could
    // not be fetched and every §3 number in this repo was a two-fixture measurement over two short
    // realist Victorian stories — the "easy end of the range" the rubric's §2 warns about.
    for (const id of ['cinderella', 'a-christmas-carol', 'the-machine-stops']) {
      expect(() => manifestFor(id)).not.toThrow();
    }
  });

  it('pins the Machine Stops slice to the story and not the collection', () => {
    const manifest = manifestFor('the-machine-stops');
    // The collection holds six stories; a slice that drifts would silently score the wrong text.
    expect(manifest.last_line - manifest.first_line).toBeLessThan(1500);
    expect(manifest.expected_words).toBeGreaterThan(11000);
    expect(manifest.expected_words).toBeLessThan(13000);
  });

  it('carries a chronology entry with a real out-of-order denominator', async () => {
    const truth = await loadGroundTruth('the-machine-stops');
    expect(truth.events.length).toBeGreaterThan(40);
    // Part II is Kuno's retrospective account, so cards 06-08 precede what card 05 depicts. If this
    // ever reads 0, either the chronology entry or the eval doc's corrected claim has rotted.
    const displaced = truth.events.filter((event, i) =>
      truth.events.some((other, j) => j > i && other.chronological_key < event.chronological_key),
    ).length;
    expect(displaced).toBeGreaterThan(0);
  });
});

describe('frame carry-over between windows (#145)', () => {
  /**
   * Answers the events pass with a scripted frame per window, and records what each window was
   * told it inherited.
   *
   * Addressed by the window number in the prompt rather than by call count, because an unusable
   * response is retried once — a call-counted stub silently scripts the wrong window as soon as a
   * failure is in play.
   */
  class FrameClient implements ModelClient {
    readonly framesSeen = new Map<number, string>();
    constructor(
      private readonly script: readonly string[],
      private readonly failOn: number = -1,
    ) {}
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const window = Number(/window (\d+) of/.exec(request.contents)?.[1] ?? 0) - 1;
      const carried = /FRAME CARRIED IN: ([^\n]*)/.exec(request.contents)?.[1] ?? '(absent)';
      this.framesSeen.set(window, carried);
      const usable = window !== this.failOn;
      return {
        // MAX_TOKENS plus unparseable text is the real failure this pass survives: see `call.ts`.
        text: usable ? JSON.stringify({ events: [], frame_at_end: this.script[window] ?? '' }) : 'not json',
        finish_reason: usable ? 'STOP' : 'MAX_TOKENS',
        model: 'stub-model',
        usage: { prompt_tokens: 1, output_tokens: 1, cached_tokens: 0, thoughts_tokens: 0 },
      };
    }
  }

  const windows = (n: number) =>
    Array.from({ length: n }, (_, index) => ({
      index,
      start: index * 10,
      end: index * 10 + 10,
      text: `window ${index}`,
      first_paragraph: index,
      last_paragraph: index,
      words: 2,
    }));

  it('tells the first window it inherited nothing', async () => {
    const client = new FrameClient(['']);
    await extractEvents(new ExtractionModel(client, 'stub-model'), windows(1), []);
    expect(client.framesSeen.get(0)).toMatch(/none/);
  });

  it('carries a frame forward until a window closes it', async () => {
    // The Stave IV shape: one window opens the vision, several more sit inside it with no signal
    // of their own, and a later one returns to the present.
    const client = new FrameClient([
      "inside the Ghost's vision of the future",
      "inside the Ghost's vision of the future",
      '',
    ]);
    const result = await extractEvents(new ExtractionModel(client, 'stub-model'), windows(4), []);
    expect(client.framesSeen.get(1)).toContain('vision of the future');
    expect(client.framesSeen.get(2)).toContain('vision of the future');
    expect(client.framesSeen.get(3)).toMatch(/none/);
    expect(result.frames.map((entry) => entry.frame)).toEqual([
      "inside the Ghost's vision of the future",
      "inside the Ghost's vision of the future",
      '',
      '',
    ]);
  });

  it('keeps the inherited frame when a window fails rather than resetting it', async () => {
    // Resetting would hand the next window a false "ordinary present" and lose the rest of a Stave
    // to one dropped call — the failure mode the carry exists to prevent.
    const client = new FrameClient(['inside a remembered childhood scene', '', ''], 1);
    const result = await extractEvents(new ExtractionModel(client, 'stub-model'), windows(3), []);
    expect(result.failed_windows).toEqual([1]);
    expect(client.framesSeen.get(2)).toContain('remembered childhood scene');
    expect(result.frames[1]).toEqual({ window: 1, frame: 'inside a remembered childhood scene' });
  });

  it('bounds a runaway frame string', async () => {
    const client = new FrameClient(['x'.repeat(5000)]);
    const result = await extractEvents(new ExtractionModel(client, 'stub-model'), windows(1), []);
    expect(result.frames[0]!.frame.length).toBeLessThanOrEqual(200);
  });
});
