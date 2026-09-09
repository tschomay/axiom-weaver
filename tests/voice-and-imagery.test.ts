import { describe, expect, it } from 'vitest';
import {
  STYLE_PRESETS,
  cardFromPreset,
  cardLabel,
  parseVoiceCard,
  presetById,
  renderSceneTone,
  renderVoiceCard,
} from '@/voice/voice-card';
import {
  buildImageryLedger,
  renderImageryLedger,
  staleImageryDomains,
  type RecordedImagery,
} from '@/voice/imagery-ledger';

describe('the Voice Card (ADR 0007)', () => {
  it('offers the five validated presets', () => {
    expect(STYLE_PRESETS).toHaveLength(5);
    expect(STYLE_PRESETS.map((preset) => preset.id)).toContain('fairy_tale_fable');
  });

  it('materializes all eight fields on selection rather than keeping a sparse diff', () => {
    const card = cardFromPreset('gothic_brooding');
    expect(card.person).not.toBe('');
    expect(card.imagery_palette.length).toBeGreaterThan(0);
    expect(card.based_on).toBe('gothic_brooding');
  });

  it('labels an edited card as modified, and an untouched one plainly', () => {
    const card = cardFromPreset('fairy_tale_fable');
    expect(cardLabel(card)).toBe('Fairy-Tale / Fable');
    expect(cardLabel({ ...card, register: 'something else' })).toBe('Fairy-Tale / Fable (modified)');
    // An array edit counts too — the palette is as much the voice as the register is.
    expect(cardLabel({ ...card, imagery_palette: ['rain'] })).toBe('Fairy-Tale / Fable (modified)');
  });

  it('rejects an unknown preset instead of quietly producing an empty card', () => {
    expect(presetById('no_such_preset')).toBeNull();
    expect(() => cardFromPreset('no_such_preset')).toThrow(/Unknown style preset/);
  });

  it("accepts the fixtures' style_preset spelling as well as based_on", () => {
    const card = parseVoiceCard({
      style_preset: 'fairy-tale / fable',
      person: 'third',
      tense: 'past',
      narrative_distance: 'close',
      register: 'plain',
      sentence_rhythm: 'short',
      imagery_palette: ['ash'],
      dialogue_density: 'low',
    });
    expect(card.based_on).toBe('fairy-tale / fable');
  });

  it('renders the block per ADR 0007 §3, omitting an empty exemplar', () => {
    const card = cardFromPreset('fairy_tale_fable');
    expect(renderVoiceCard(card)).not.toContain('Exemplar');
    expect(renderVoiceCard({ ...card, style_exemplar: 'a line' })).toContain('Exemplar');
  });

  it('keeps tone in its own block so it modulates the voice instead of editing it', () => {
    expect(renderVoiceCard(cardFromPreset('fairy_tale_fable'))).not.toContain('SCENE TONE');
    expect(renderSceneTone('wistful')).toContain('never overrides the voice above');
    expect(renderSceneTone(undefined)).toBe('');
  });
});

describe('the imagery ledger (ADR 0010)', () => {
  const card = cardFromPreset('fairy_tale_fable');
  const [first, second] = card.imagery_palette as [string, string];

  const history: RecordedImagery[] = [
    { scene_order: 1, signature: [{ image: 'ash on a cold grate', domain: first }] },
    { scene_order: 3, signature: [{ image: 'ash gone grey', domain: first }] },
    { scene_order: 4, signature: [{ image: 'a borrowed phrase', domain: null }] },
  ];

  it('groups uses by domain and lists what has not been drawn from yet', () => {
    const ledger = buildImageryLedger(card, history);
    expect(ledger.used).toHaveLength(1);
    expect(ledger.used[0]?.domain).toBe(first);
    expect(ledger.used[0]?.scenes).toEqual([1, 3]);
    expect(ledger.unused).toContain(second);
    // An ad hoc image is outside the palette, so it neither fills nor exhausts a domain.
    expect(ledger.ad_hoc).toEqual(['a borrowed phrase']);
    expect(ledger.unused).not.toContain('a borrowed phrase');
  });

  it('renders positively — prior phrasings to vary against, never a blocklist', () => {
    const rendered = renderImageryLedger(buildImageryLedger(card, history));
    expect(rendered).toContain('vary the phrasing, not the domain');
    expect(rendered).toContain('already drawn from');
    expect(rendered).toContain('not yet drawn from');
    expect(rendered).not.toMatch(/do not use|avoid/i);
  });

  it('degrades to a pure already-drawn-from list once the palette is exhausted', () => {
    const exhausted = card.imagery_palette.map((domain, index) => ({
      scene_order: index + 1,
      signature: [{ image: `image ${index}`, domain }],
    }));
    const rendered = renderImageryLedger(buildImageryLedger(card, exhausted));
    expect(rendered).toContain('already drawn from');
    expect(rendered).not.toContain('not yet drawn from');
  });

  it('renders nothing at all when there is no palette and no history', () => {
    expect(renderImageryLedger(buildImageryLedger({ ...card, imagery_palette: [] }, []))).toBe('');
  });

  it('flags a domain reused with identical phrasing, not one merely reused', () => {
    // Recurrence within a domain is a motif. Repeating the exact vehicle is not.
    expect(staleImageryDomains(history)).toEqual([]);
    expect(
      staleImageryDomains([
        { scene_order: 1, signature: [{ image: 'rain on glass', domain: first }] },
        { scene_order: 2, signature: [{ image: 'Rain on glass ', domain: first }] },
      ]),
    ).toEqual([first]);
  });
});
