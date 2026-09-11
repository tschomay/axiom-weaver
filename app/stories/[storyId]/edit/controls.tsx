'use client';

/**
 * The controls the authoring screen is built from.
 *
 * Every one of them is stacked — label above control, wrapping rather than scrolling — because
 * ADR 0017 §7 rules out a horizontally scrolling grid at any width, and the cheapest way to keep
 * that true is to have no grid to begin with. The same control renders on a phone and a desktop.
 */

import { useState } from 'react';
import type { BagValue } from '@/schema/story-package';
import type { TableName } from '@/schema/tiers';
import {
  BAG_ROW_TYPES,
  BAG_TYPE_LABELS,
  TIER_TITLES,
  bagFromRows,
  bagSignature,
  choicesIncluding,
  coerceBagValue,
  columnTier,
  reconcileBagRows,
  type BagDraft,
  type BagRow,
  type BagRowType,
  type EntityChoice,
} from '@/authoring/editor-model';

export function Tier({ table, column }: { table: TableName; column: string }) {
  const tier = columnTier(table, column);
  if (tier === null) return null;
  return (
    <span className={`tier ${tier}`} title={TIER_TITLES[tier]}>
      {tier}
    </span>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  flagged?: boolean;
  table?: TableName;
  column?: string;
  /** True where the field holds several controls — a list, a bag — rather than one. */
  group?: boolean;
  children: React.ReactNode;
}

/**
 * The control wraps *inside* its `<label>`, which associates the two without either needing an
 * id. Ids would have to be unique across a screen that renders the same field for every row of
 * five tables, so generating them correctly is work; nesting is correct by construction.
 */
export function Field({ label, hint, flagged, table, column, group, children }: FieldProps) {
  const heading = (
    <>
      {label}
      {table !== undefined && column !== undefined ? <Tier table={table} column={column} /> : null}
    </>
  );
  const className = flagged === true ? 'field flagged' : 'field';
  const note = hint === undefined || hint === '' ? null : <span className="hint">{hint}</span>;

  // A `<label>` may contain one labelable control, so a field holding several is a fieldset
  // instead and each control inside carries its own `aria-label`.
  if (group === true) {
    return (
      <fieldset className={className}>
        <legend className="label-text">{heading}</legend>
        {children}
        {note}
      </fieldset>
    );
  }

  return (
    <div className={className}>
      <label>
        <span className="label-text">{heading}</span>
        {children}
      </label>
      {note}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  flagged,
  table,
  column,
  disabled,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  flagged?: boolean;
  table?: TableName;
  column?: string;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <Field label={label} hint={hint} flagged={flagged} table={table} column={column}>
      {multiline === true ? (
        <textarea
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * An id control — a picker over the seed, never a text box (ADR 0017 §6).
 *
 * `allowNone` is what a nullable foreign key looks like: "nowhere in particular" is a real
 * answer for a character's `location_id`, and it has to be reachable without clearing a typed
 * string, because there is no typed string.
 */
export function EntityPicker({
  label,
  value,
  choices,
  onChange,
  allowNone,
  noneLabel,
  hint,
  flagged,
  table,
  column,
}: {
  label: string;
  value: string | null;
  choices: readonly EntityChoice[];
  onChange: (next: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  hint?: string;
  flagged?: boolean;
  table?: TableName;
  column?: string;
}) {
  const options = choicesIncluding(choices, value);
  const empty = options.length === 0;

  return (
    <Field
      label={label}
      hint={empty ? 'nothing to pick yet — add one in the World Model seed first' : hint}
      flagged={flagged}
      table={table}
      column={column}
    >
      <select
        value={value ?? ''}
        disabled={empty && (allowNone !== true || value === null)}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{allowNone === true ? (noneLabel ?? '— none —') : '— pick one —'}</option>
        {options.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A set of ids — `characters_present`, and any other many-valued reference. */
export function EntityMultiPicker({
  label,
  values,
  choices,
  onChange,
  hint,
  flagged,
}: {
  label: string;
  values: readonly string[];
  choices: readonly EntityChoice[];
  onChange: (next: string[]) => void;
  hint?: string;
  flagged?: boolean;
}) {
  const unused = choices.filter((choice) => !values.includes(choice.id));
  return (
    <Field label={label} hint={hint} flagged={flagged} group>
      {values.length === 0 ? <span className="hint">none yet</span> : null}
      {values.map((id) => {
        const choice = choices.find((entry) => entry.id === id);
        return (
          <div className="list-row" key={id}>
            <span className="meta">{choice === undefined ? `${id} — not in the seed` : choice.label}</span>
            <button
              type="button"
              className="tiny"
              onClick={() => onChange(values.filter((entry) => entry !== id))}
            >
              remove
            </button>
          </div>
        );
      })}
      <select
        value=""
        aria-label={`add to ${label}`}
        disabled={unused.length === 0}
        onChange={(event) => {
          if (event.target.value === '') return;
          onChange([...values, event.target.value]);
        }}
      >
        <option value="">{unused.length === 0 ? '— nothing left to add —' : '— add one —'}</option>
        {unused.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A list of free strings — the Voice Card's imagery palette, a scene's required beats. */
export function StringListField({
  label,
  values,
  onChange,
  hint,
  placeholder,
  flagged,
  multiline,
}: {
  label: string;
  values: readonly string[];
  onChange: (next: string[]) => void;
  hint?: string;
  placeholder?: string;
  flagged?: boolean;
  /** For entries that are sentences — a beat, an invariant — rather than phrases. */
  multiline?: boolean;
}) {
  return (
    <Field label={label} hint={hint} flagged={flagged} group>
      {values.map((entry, index) => (
        // Keyed by position, not value: the value is what the author is editing, and keying by
        // it would re-mount the input on every keystroke.
        <div className={multiline === true ? 'list-row tall' : 'list-row'} key={index}>
          {multiline === true ? (
            <textarea
              aria-label={`${label} ${index + 1}`}
              value={entry}
              placeholder={placeholder}
              rows={2}
              onChange={(event) =>
                onChange(values.map((old, at) => (at === index ? event.target.value : old)))
              }
            />
          ) : (
            <input
              type="text"
              aria-label={`${label} ${index + 1}`}
              value={entry}
              placeholder={placeholder}
              onChange={(event) =>
                onChange(values.map((old, at) => (at === index ? event.target.value : old)))
              }
            />
          )}
          <button
            type="button"
            className="tiny"
            onClick={() => onChange(values.filter((_, at) => at !== index))}
          >
            remove
          </button>
        </div>
      ))}
      <button type="button" className="tiny" onClick={() => onChange([...values, ''])}>
        add
      </button>
    </Field>
  );
}

/**
 * A bag: flat key/value rows, and a type per row.
 *
 * The type list has no "object" in it, which is how Principle 4 is enforced here — not by
 * validating what the author typed, but by never offering a control that could produce a nested
 * value in the first place.
 */
export function BagEditor({
  bag,
  onChange,
}: {
  bag: Record<string, BagValue> | undefined;
  onChange: (next: Record<string, BagValue>) => void;
}) {
  // A row with no key yet is a row in progress: it lives here, not in the package, so the
  // editor holds its own rows for as long as the package still holds what they produce.
  const [draft, setDraft] = useState<BagDraft | null>(null);
  const rows = reconcileBagRows(bag, draft);

  const write = (next: BagRow[]) => {
    const produced = bagFromRows(next);
    setDraft({ produced: bagSignature(produced), rows: next });
    onChange(produced);
  };
  const replace = (index: number, row: BagRow) =>
    write(rows.map((old, at) => (at === index ? row : old)));

  return (
    <Field
      label="bag"
      group
      hint="flat key/value only — Principle 4 rules out nesting, so the control does not offer it"
    >
      {rows.length === 0 ? <span className="hint">empty</span> : null}
      {rows.map((row, index) => (
        // Keyed by position, as above: the key of a bag row is itself editable.
        <div className="bag-row" key={index}>
          <input
            className="key"
            type="text"
            aria-label="key"
            value={row.key}
            spellCheck={false}
            placeholder="key"
            onChange={(event) => replace(index, { ...row, key: event.target.value })}
          />
          <select
            aria-label="value type"
            value={row.type}
            onChange={(event) => {
              const type = event.target.value as BagRowType;
              replace(index, { ...row, type, value: coerceBagValue(row.value, type) });
            }}
          >
            {BAG_ROW_TYPES.map((type) => (
              <option key={type} value={type}>
                {BAG_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <BagValueControl
            row={row}
            onChange={(value) => replace(index, { ...row, value })}
          />
          <button
            type="button"
            className="tiny"
            onClick={() => write(rows.filter((_, at) => at !== index))}
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="tiny"
        onClick={() => write([...rows, { key: '', type: 'text', value: '' }])}
      >
        add a key
      </button>
    </Field>
  );
}

function BagValueControl({
  row,
  onChange,
}: {
  row: BagRow;
  onChange: (next: BagValue) => void;
}) {
  if (row.type === 'empty') return <span className="hint val">no value</span>;

  if (row.type === 'boolean') {
    return (
      <select
        className="val"
        aria-label="value"
        value={row.value === true ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (row.type === 'list') {
    const values = Array.isArray(row.value) ? row.value : [];
    return (
      <input
        className="val"
        type="text"
        aria-label="value"
        value={values.join(', ')}
        placeholder="comma, separated, values"
        onChange={(event) =>
          onChange(
            event.target.value
              .split(',')
              .map((part) => part.trim())
              .filter((part) => part !== ''),
          )
        }
      />
    );
  }

  return (
    <input
      className="val"
      type="text"
      aria-label="value"
      inputMode={row.type === 'number' ? 'decimal' : undefined}
      value={row.value === null ? '' : String(row.value)}
      placeholder="value"
      onChange={(event) =>
        onChange(row.type === 'number' ? Number(event.target.value) : event.target.value)
      }
    />
  );
}
