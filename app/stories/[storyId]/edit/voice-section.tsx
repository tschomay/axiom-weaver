'use client';

import type { DraftStoryPackage } from '@/schema/manuscript';
import { cardLabel, type VoiceCard } from '@/voice/voice-card';
import {
  VOICE_TEXT_FIELDS,
  applyPreset,
  draftVoiceCard,
  presetChoices,
  voiceCardBlock,
  voiceCardIsBlank,
} from '@/authoring/editor-model';
import { StringListField, TextField } from './controls';

/**
 * The Voice Card: pick a preset, then override any field.
 *
 * Every edit here writes the **whole card** back (ADR 0007 decision 4). A sparse diff against a
 * shared preset was rejected because resolving it at render time would let a later edit to that
 * preset silently change the voice of every story already using it, mid-telling — so this editor
 * never produces one, and `based_on` survives only as a label and a reset.
 */
export function VoiceSection({
  pkg,
  onChange,
  flagged,
}: {
  pkg: DraftStoryPackage;
  onChange: (next: DraftStoryPackage) => void;
  flagged: (path: string) => boolean;
}) {
  const card = draftVoiceCard(pkg.voice_card);
  const write = (next: VoiceCard) => onChange({ ...pkg, voice_card: voiceCardBlock(next) });
  const blank = voiceCardIsBlank(card);

  return (
    <section>
      <h2>Voice Card</h2>
      <p className="lede">
        Eight fields that hold steady across the whole telling. A scene&apos;s own tone modulates
        within this voice rather than editing it, which is why tone lives on the Scene Card and not
        here.
      </p>

      <div className="field">
        <label>
          <span className="label-text">
            Start from a preset
            {blank ? null : <span className="tag">{cardLabel(card)}</span>}
          </span>
          <select
            value={card.based_on ?? ''}
            onChange={(event) => {
              if (event.target.value === '') return;
              write(applyPreset(event.target.value));
            }}
          >
            <option value="">{blank ? '— pick one —' : 'Custom'}</option>
            {presetChoices().map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          Picking one copies all eight fields onto this card. Editing a field afterwards edits it
          here, not the preset — nothing you write is a diff against anything.
        </span>
        {card.based_on === null ? null : (
          <div className="row-actions">
            <button
              type="button"
              className="tiny"
              onClick={() => write(applyPreset(card.based_on as string))}
            >
              reset to the preset
            </button>
          </div>
        )}
      </div>

      {blank ? (
        <p className="empty-note">
          Nothing set yet. A story publishes fine without a Voice Card — the linter warns rather
          than blocks — but every scene will be written in whatever voice the model reaches for.
        </p>
      ) : null}

      {VOICE_TEXT_FIELDS.map((entry) => (
        <TextField
          key={entry.field}
          label={entry.label}
          hint={entry.hint}
          value={card[entry.field]}
          multiline={entry.field !== 'person' && entry.field !== 'tense'}
          flagged={flagged(`voice_card.${entry.field}`)}
          onChange={(value) => write({ ...card, [entry.field]: value })}
        />
      ))}

      <StringListField
        label="Imagery palette"
        values={card.imagery_palette}
        placeholder="hearth and ash"
        flagged={flagged('voice_card.imagery_palette')}
        hint="domains to draw fresh images from — never phrases to reuse verbatim"
        onChange={(imagery_palette) => write({ ...card, imagery_palette })}
      />
    </section>
  );
}
