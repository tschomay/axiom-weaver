'use client';

import { useState } from 'react';
import type { DraftStoryPackage } from '@/schema/manuscript';
import type { StateValue } from '@/schema/story-package';
import type { TableName } from '@/schema/tiers';
import { TIER_TITLES, entityChoices, sceneChoices } from '@/authoring/editor-model';
import {
  blankKnowledgeRow,
  blankRelationshipRow,
  columnChoices,
  reconcileStateRows,
  stateFromRows,
  stateSignature,
  tableForEntity,
  type StateDraft,
  type StateRow,
} from '@/authoring/scene-editor';
import { EntityPicker, Field, TextField } from './controls';

/**
 * `entry_state` / `exit_state` as rows: entity → column → value (ADR 0017 §6).
 *
 * Never as JSON, and never as a grid. The column list comes from `src/schema/tiers.ts` and carries
 * its P/E/V tier inline, so an author asserting `goal` can see that it is a **volitional**
 * assertion at the moment they assert it — rather than reading it in a document, or discovering
 * it when the engine declines to commit one.
 *
 * The same control renders at every width. ADR 0017 §7 rules out a horizontally scrolling grid,
 * and a list of rows is the cheapest way to have nothing to scroll.
 */
export function StateEditor({
  label,
  hint,
  state,
  sceneId,
  pkg,
  onChange,
}: {
  label: string;
  hint: string;
  state: DraftStoryPackage['scene_cards'][number]['entry_state'];
  sceneId: string;
  pkg: DraftStoryPackage;
  onChange: (next: DraftStoryPackage['scene_cards'][number]['entry_state']) => void;
}) {
  // A row with no entity or no column yet is a row in progress: it lives here, not in the
  // package, so the editor holds its own rows while the package still holds what they produce.
  const [draft, setDraft] = useState<StateDraft | null>(null);
  const rows = reconcileStateRows(state, draft);
  const seed = pkg.world_model_seed;
  const entities = entityChoices(seed, ['character', 'location', 'object', 'relationship']);
  const characters = entityChoices(seed, ['character']);
  const endpoints = entityChoices(seed, ['character', 'location', 'object']);
  const scenes = sceneChoices(pkg.scene_cards);

  const write = (next: StateRow[]) => {
    const produced = stateFromRows(next);
    setDraft({ produced: stateSignature(produced), rows: next });
    onChange(produced);
  };
  const replace = (index: number, row: StateRow) =>
    write(rows.map((old, at) => (at === index ? row : old)));
  const remove = (index: number) => write(rows.filter((_, at) => at !== index));

  return (
    <section className="state-editor">
      <h3>{label}</h3>
      <p className="hint">{hint}</p>

      {rows.length === 0 ? <p className="empty-note">Nothing asserted here.</p> : null}

      {rows.map((row, index) => {
        if (row.kind === 'column') {
          const table = tableForEntity(seed, row.entity_id);
          const columns = columnChoices(table, row.column);
          return (
            // Keyed by position: the same entity may be asserted on several columns.
            <div className="state-row" key={index}>
              <EntityPicker
                label="entity"
                value={row.entity_id === '' ? null : row.entity_id}
                choices={entities}
                onChange={(entity_id) =>
                  // The column belongs to the old entity's table, so changing the entity clears
                  // it rather than carrying a column the new table may not have.
                  replace(index, { ...row, entity_id: entity_id ?? '', column: '' })
                }
              />
              <Field label="column">
                <select
                  value={row.column}
                  disabled={columns.length === 0}
                  onChange={(event) => replace(index, { ...row, column: event.target.value })}
                >
                  <option value="">
                    {table === null ? '— pick an entity first —' : '— pick a column —'}
                  </option>
                  {columns.map((choice) => (
                    <option key={choice.column} value={choice.column}>
                      {choice.column}
                      {choice.tier === null ? '' : ` · ${choice.tier}`}
                    </option>
                  ))}
                </select>
              </Field>
              <TierNote table={table} column={row.column} />
              <ValueField
                value={row.value}
                onChange={(value) => replace(index, { ...row, value })}
              />
              <div className="row-actions">
                <button type="button" className="tiny" onClick={() => remove(index)}>
                  remove this assertion
                </button>
              </div>
            </div>
          );
        }

        if (row.kind === 'relationship') {
          const data = row.row as Record<string, string | null>;
          const set = (patch: Record<string, unknown>) =>
            replace(index, { ...row, row: { ...row.row, ...patch } });
          return (
            <div className="state-row created" key={index}>
              <p className="hint">a relationship this scene creates</p>
              <EntityPicker
                label="from"
                value={data['from_id'] ?? null}
                choices={endpoints}
                onChange={(from_id) => set({ from_id: from_id ?? '' })}
              />
              <EntityPicker
                label="to"
                value={data['to_id'] ?? null}
                choices={endpoints}
                onChange={(to_id) => set({ to_id: to_id ?? '' })}
              />
              <TextField
                label="kind"
                table="relationship"
                column="kind"
                value={data['kind'] ?? ''}
                onChange={(kind) => set({ kind })}
              />
              <TextField
                label="sentiment"
                table="relationship"
                column="sentiment"
                value={data['sentiment'] ?? ''}
                onChange={(sentiment) => set({ sentiment: sentiment === '' ? null : sentiment })}
              />
              <TextField label="id" value={data['id'] ?? ''} onChange={(id) => set({ id })} />
              <div className="row-actions">
                <button type="button" className="tiny" onClick={() => remove(index)}>
                  remove this row
                </button>
              </div>
            </div>
          );
        }

        const data = row.row as Record<string, string | null>;
        const set = (patch: Record<string, unknown>) =>
          replace(index, { ...row, row: { ...row.row, ...patch } });
        return (
          <div className="state-row created" key={index}>
            <p className="hint">something a character learns in this scene</p>
            <EntityPicker
              label="who learns it"
              value={data['character_id'] ?? null}
              choices={characters}
              onChange={(character_id) => set({ character_id: character_id ?? '' })}
            />
            <TextField
              label="fact"
              value={data['fact_ref'] ?? ''}
              onChange={(fact_ref) => set({ fact_ref })}
            />
            <EntityPicker
              label="learned at scene"
              value={data['learned_at_scene'] ?? null}
              choices={scenes}
              allowNone
              noneLabel="— known from the seed —"
              onChange={(learned_at_scene) => set({ learned_at_scene })}
            />
            <TextField label="id" value={data['id'] ?? ''} onChange={(id) => set({ id })} />
            <div className="row-actions">
              <button type="button" className="tiny" onClick={() => remove(index)}>
                remove this row
              </button>
            </div>
          </div>
        );
      })}

      <div className="row-actions">
        <button
          type="button"
          className="action"
          onClick={() => write([...rows, { kind: 'column', entity_id: '', column: '', value: '' }])}
        >
          Assert a column
        </button>
        <button
          type="button"
          className="action"
          onClick={() =>
            write([...rows, { kind: 'relationship', row: blankRelationshipRow(rows.length + 1) }])
          }
        >
          Create a relationship
        </button>
        <button
          type="button"
          className="action"
          onClick={() =>
            write([
              ...rows,
              { kind: 'knowledge', row: blankKnowledgeRow(rows.length + 1, sceneId) },
            ])
          }
        >
          Someone learns something
        </button>
      </div>
    </section>
  );
}

/**
 * The tier, spelled out beside the assertion — but only where it changes what to expect.
 *
 * Every column carries its tier in the picker itself (`status · P`), so a row asserting a
 * physical column has already said so. Repeating the sentence on every row would put the same
 * paragraph on screen eight times, and a note that appears everywhere is a note nobody reads —
 * which is the risk ADR 0016 §4 already cut `info` diagnostics for. **V** is the one an author
 * can be surprised by: the engine may propose a change here and may not commit one.
 */
function TierNote({ table, column }: { table: TableName | null; column: string }) {
  if (table === null || column === '') return null;
  const tier = columnChoices(table, column).find((choice) => choice.column === column)?.tier;
  if (tier !== 'V') return null;
  return <p className="hint tier-note volitional">{TIER_TITLES.V}</p>;
}

/**
 * A column's value: the four scalars `StateValueSchema` allows, and no fifth.
 *
 * Same reasoning as a bag's value control — the shapes the schema permits are the shapes the
 * control can produce, so there is nothing to validate afterwards.
 */
function ValueField({
  value,
  onChange,
}: {
  value: StateValue;
  onChange: (next: StateValue) => void;
}) {
  const kind =
    value === null ? 'empty' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text';

  return (
    <Field label="value" group>
      <div className="list-row">
        <select
          aria-label="value type"
          value={kind}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'empty') return onChange(null);
            if (next === 'number') return onChange(Number(value ?? 0) || 0);
            if (next === 'boolean') return onChange(value === true || value === 'true');
            return onChange(value === null ? '' : String(value));
          }}
        >
          <option value="text">text</option>
          <option value="number">number</option>
          <option value="boolean">true / false</option>
          <option value="empty">empty</option>
        </select>
        {kind === 'empty' ? (
          <span className="hint">no value</span>
        ) : kind === 'boolean' ? (
          <select
            aria-label="value"
            value={value === true ? 'true' : 'false'}
            onChange={(event) => onChange(event.target.value === 'true')}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            type="text"
            aria-label="value"
            inputMode={kind === 'number' ? 'decimal' : undefined}
            value={String(value)}
            onChange={(event) =>
              onChange(kind === 'number' ? Number(event.target.value) : event.target.value)
            }
          />
        )}
      </div>
    </Field>
  );
}
