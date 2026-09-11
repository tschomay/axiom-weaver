'use client';

import { useState } from 'react';
import type { DraftStoryPackage } from '@/schema/manuscript';
import type { BagValue } from '@/schema/story-package';
import {
  SEED_TABLES,
  entityChoices,
  mintEntityId,
  sceneChoices,
  seedIds,
  seedRowPath,
  type SeedTable,
} from '@/authoring/editor-model';
import { BagEditor, EntityPicker, TextField } from './controls';

type Seed = DraftStoryPackage['world_model_seed'];
type SeedArray = SeedTable['array'];

/**
 * The World Model seed — what is true before scene one.
 *
 * Five tables, one list of stacked cards each. Every id reference is a picker over the seed and
 * never a typed slug (ADR 0017 §6): #18 measured that the errors hand-authoring actually produces
 * are cross-reference errors, and a picker cannot produce one. The one place an id is still typed
 * is a row's own `id`, which names nothing but itself.
 */
export function WorldSection({
  pkg,
  onChange,
  flagged,
  focusPath,
}: {
  pkg: DraftStoryPackage;
  onChange: (next: DraftStoryPackage) => void;
  flagged: (path: string) => boolean;
  focusPath: string | null;
}) {
  // A lint problem is only navigable if following it lands on the row, so the focused path
  // decides which table is open and which card is expanded. The author's own choice is tagged
  // with the path it was made under and wins only while that path is still the current one —
  // which is what lets a new problem take over without an effect racing the render that set it.
  const [chosen, setChosen] = useState<{
    under: string | null;
    array: SeedArray;
    open: string | null;
  } | null>(null);

  const focused = focusedRow(focusPath);
  const active =
    chosen !== null && chosen.under === focusPath
      ? chosen
      : { under: focusPath, array: focused?.array ?? 'characters', open: focused?.open ?? null };

  const array = active.array;
  const open = active.open;
  const setArray = (next: SeedArray) => setChosen({ under: focusPath, array: next, open: null });
  const setOpen = (next: string | null) => setChosen({ under: focusPath, array, open: next });

  const seed = pkg.world_model_seed;
  const table = SEED_TABLES.find((entry) => entry.array === array) as SeedTable;

  const writeSeed = (next: Partial<Seed>) =>
    onChange({ ...pkg, world_model_seed: { ...seed, ...next } });

  return (
    <section>
      <h2>World Model seed</h2>
      <p className="lede">
        What is true before scene one. Scene Cards assert changes against these rows, so an entity
        has to exist here before a scene can move it, and a reference to a row that is not here is
        the error the linter reports first.
      </p>

      <div className="entity-tabs">
        {SEED_TABLES.map((entry) => {
          const count = (seed[entry.array] ?? []).length;
          return (
            <button
              key={entry.array}
              type="button"
              className={entry.array === array ? 'action primary' : 'action'}
              onClick={() => setArray(entry.array)}
            >
              {entry.label} {count === 0 ? '' : `(${count})`}
            </button>
          );
        })}
      </div>

      {array === 'characters' ? (
        <CharacterRows
          seed={seed}
          open={open}
          setOpen={setOpen}
          flagged={flagged}
          writeSeed={writeSeed}
          table={table}
        />
      ) : array === 'locations' ? (
        <LocationRows
          seed={seed}
          open={open}
          setOpen={setOpen}
          flagged={flagged}
          writeSeed={writeSeed}
          table={table}
        />
      ) : array === 'objects' ? (
        <ObjectRows
          seed={seed}
          open={open}
          setOpen={setOpen}
          flagged={flagged}
          writeSeed={writeSeed}
          table={table}
        />
      ) : array === 'relationships' ? (
        <RelationshipRows
          seed={seed}
          open={open}
          setOpen={setOpen}
          flagged={flagged}
          writeSeed={writeSeed}
          table={table}
        />
      ) : (
        <KnowledgeRows
          seed={seed}
          pkg={pkg}
          open={open}
          setOpen={setOpen}
          flagged={flagged}
          writeSeed={writeSeed}
          table={table}
        />
      )}
    </section>
  );
}

/** The table and row a lint path points at, when it points into the seed at all. */
function focusedRow(focusPath: string | null): { array: SeedArray; open: string | null } | null {
  if (focusPath === null) return null;
  const [head, table, id] = focusPath.split('.');
  if (head !== 'world_model_seed' || table === undefined) return null;
  if (!SEED_TABLES.some((entry) => entry.array === table)) return null;
  return { array: table as SeedArray, open: id ?? null };
}

// --- The shell every row shares -----------------------------------------------------------

interface RowsProps {
  seed: Seed;
  open: string | null;
  setOpen: (id: string | null) => void;
  flagged: (path: string) => boolean;
  writeSeed: (next: Partial<Seed>) => void;
  table: SeedTable;
}

function EntityCard({
  id,
  name,
  subtitle,
  open,
  setOpen,
  flaggedRow,
  onRemove,
  onIdChange,
  children,
}: {
  id: string;
  name: string;
  subtitle: string;
  open: string | null;
  setOpen: (id: string | null) => void;
  flaggedRow: boolean;
  onRemove: () => void;
  onIdChange: (next: string) => void;
  children: React.ReactNode;
}) {
  return (
    <details
      className={flaggedRow ? 'entity-card flagged' : 'entity-card'}
      open={open === id}
      onToggle={(event) => setOpen(event.currentTarget.open ? id : null)}
    >
      <summary>
        <span className="name">{name === '' ? '(unnamed)' : name}</span>
        <span className="id">{id === '' ? '(no id)' : id}</span>
        {subtitle === '' ? null : <span className="meta">{subtitle}</span>}
      </summary>

      <TextField
        label="id"
        value={id}
        onChange={onIdChange}
        hint="story-scoped, and what every reference to this row points at — renaming it here does not rename the references"
      />
      {children}
      <div className="row-actions">
        <button type="button" className="tiny" onClick={onRemove}>
          remove this row
        </button>
      </div>
    </details>
  );
}

/** The add control: a name, then the id minted from it — never an id the author types. */
function AddRow({
  noun,
  named,
  onAdd,
}: {
  noun: string;
  named: boolean;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState('');
  if (!named) {
    return (
      <button type="button" className="action" onClick={() => onAdd('')}>
        Add a {noun}
      </button>
    );
  }
  return (
    <div className="list-row">
      <input
        type="text"
        value={name}
        placeholder={`name of the new ${noun}`}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || name.trim() === '') return;
          onAdd(name.trim());
          setName('');
        }}
      />
      <button
        type="button"
        className="action"
        disabled={name.trim() === ''}
        onClick={() => {
          onAdd(name.trim());
          setName('');
        }}
      >
        Add {noun}
      </button>
    </div>
  );
}

function Empty({ noun }: { noun: string }) {
  return (
    <p className="empty-note">
      No {noun} rows yet. A new story starts with an empty seed — nothing here is wrong, there is
      just nothing for a scene to refer to until something is.
    </p>
  );
}

/** Every row editor mints and replaces the same way; this is that shape, once. */
function useRowOps<T extends { id?: string }>(
  rows: readonly T[],
  seed: Seed,
  table: SeedTable,
  writeSeed: (next: Partial<Seed>) => void,
  setOpen: (id: string | null) => void,
) {
  const replace = (index: number, row: T) =>
    writeSeed({ [table.array]: rows.map((old, at) => (at === index ? row : old)) } as Partial<Seed>);
  const remove = (index: number) =>
    writeSeed({ [table.array]: rows.filter((_, at) => at !== index) } as Partial<Seed>);
  const add = (row: Omit<T, 'id'>, name: string) => {
    const id = mintEntityId(
      table.prefix,
      name === '' ? String(rows.length + 1) : name,
      seedIds(seed),
    );
    writeSeed({ [table.array]: [...rows, { ...row, id }] } as Partial<Seed>);
    setOpen(id);
  };
  return { replace, remove, add };
}

// --- Characters ---------------------------------------------------------------------------

function CharacterRows({ seed, open, setOpen, flagged, writeSeed, table }: RowsProps) {
  const rows = seed.characters ?? [];
  const { replace, remove, add } = useRowOps(rows, seed, table, writeSeed, setOpen);
  const locations = entityChoices(seed, ['location']);

  return (
    <>
      {rows.length === 0 ? <Empty noun="character" /> : null}
      {rows.map((row, index) => {
        const id = row.id ?? '';
        return (
          <EntityCard
            key={index}
            id={id}
            name={row.name ?? ''}
            subtitle={row.location_id ?? ''}
            open={open}
            setOpen={setOpen}
            flaggedRow={flagged(seedRowPath('characters', id))}
            onRemove={() => remove(index)}
            onIdChange={(next) => replace(index, { ...row, id: next })}
          >
            <TextField
              label="name"
              table="character"
              column="name"
              value={row.name ?? ''}
              onChange={(name) => replace(index, { ...row, name })}
            />
            <EntityPicker
              label="location"
              table="character"
              column="location_id"
              value={row.location_id ?? null}
              choices={locations}
              allowNone
              noneLabel="— nowhere in particular —"
              flagged={flagged(seedRowPath('characters', id, 'location_id'))}
              onChange={(location_id) => replace(index, { ...row, location_id })}
            />
            <TextField
              label="status"
              table="character"
              column="status"
              value={row.status ?? ''}
              onChange={(status) => replace(index, { ...row, status: status === '' ? null : status })}
              hint="a physical fact the engine may write and auto-commit"
            />
            <TextField
              label="goal"
              table="character"
              column="goal"
              value={row.goal ?? ''}
              onChange={(goal) => replace(index, { ...row, goal: goal === '' ? null : goal })}
              hint="volitional: the engine may only propose a change here, never commit one"
            />
            <BagEditor
              bag={row.bag as Record<string, BagValue> | undefined}
              onChange={(bag) => replace(index, { ...row, bag })}
            />
          </EntityCard>
        );
      })}
      <AddRow noun="character" named onAdd={(name) => add({ name, bag: {} }, name)} />
    </>
  );
}

// --- Locations ----------------------------------------------------------------------------

function LocationRows({ seed, open, setOpen, flagged, writeSeed, table }: RowsProps) {
  const rows = seed.locations ?? [];
  const { replace, remove, add } = useRowOps(rows, seed, table, writeSeed, setOpen);

  return (
    <>
      {rows.length === 0 ? <Empty noun="location" /> : null}
      {rows.map((row, index) => {
        const id = row.id ?? '';
        return (
          <EntityCard
            key={index}
            id={id}
            name={row.name ?? ''}
            subtitle=""
            open={open}
            setOpen={setOpen}
            flaggedRow={flagged(seedRowPath('locations', id))}
            onRemove={() => remove(index)}
            onIdChange={(next) => replace(index, { ...row, id: next })}
          >
            <TextField
              label="name"
              table="location"
              column="name"
              value={row.name ?? ''}
              onChange={(name) => replace(index, { ...row, name })}
            />
            <BagEditor
              bag={row.bag as Record<string, BagValue> | undefined}
              onChange={(bag) => replace(index, { ...row, bag })}
            />
          </EntityCard>
        );
      })}
      <AddRow noun="location" named onAdd={(name) => add({ name, bag: {} }, name)} />
    </>
  );
}

// --- Objects ------------------------------------------------------------------------------

function ObjectRows({ seed, open, setOpen, flagged, writeSeed, table }: RowsProps) {
  const rows = seed.objects ?? [];
  const { replace, remove, add } = useRowOps(rows, seed, table, writeSeed, setOpen);
  const places = entityChoices(seed, ['location', 'character']);

  return (
    <>
      {rows.length === 0 ? <Empty noun="object" /> : null}
      {rows.map((row, index) => {
        const id = row.id ?? '';
        return (
          <EntityCard
            key={index}
            id={id}
            name={row.name ?? ''}
            subtitle={row.location_id ?? ''}
            open={open}
            setOpen={setOpen}
            flaggedRow={flagged(seedRowPath('objects', id))}
            onRemove={() => remove(index)}
            onIdChange={(next) => replace(index, { ...row, id: next })}
          >
            <TextField
              label="name"
              table="object"
              column="name"
              value={row.name ?? ''}
              onChange={(name) => replace(index, { ...row, name })}
            />
            <EntityPicker
              label="where it is"
              table="object"
              column="location_id"
              value={row.location_id ?? null}
              choices={places}
              allowNone
              noneLabel="— nowhere in particular —"
              hint="a location, or the character carrying it"
              flagged={flagged(seedRowPath('objects', id, 'location_id'))}
              onChange={(location_id) => replace(index, { ...row, location_id })}
            />
            <TextField
              label="status"
              table="object"
              column="status"
              value={row.status ?? ''}
              onChange={(status) => replace(index, { ...row, status: status === '' ? null : status })}
            />
            <BagEditor
              bag={row.bag as Record<string, BagValue> | undefined}
              onChange={(bag) => replace(index, { ...row, bag })}
            />
          </EntityCard>
        );
      })}
      <AddRow noun="object" named onAdd={(name) => add({ name, bag: {} }, name)} />
    </>
  );
}

// --- Relationships ------------------------------------------------------------------------

function RelationshipRows({ seed, open, setOpen, flagged, writeSeed, table }: RowsProps) {
  const rows = seed.relationships ?? [];
  const { replace, remove, add } = useRowOps(rows, seed, table, writeSeed, setOpen);
  const endpoints = entityChoices(seed, ['character', 'location', 'object']);

  return (
    <>
      {rows.length === 0 ? <Empty noun="relationship" /> : null}
      {rows.map((row, index) => {
        const id = row.id ?? '';
        return (
          <EntityCard
            key={index}
            id={id}
            name={row.kind ?? ''}
            subtitle={`${row.from_id ?? '?'} → ${row.to_id ?? '?'}`}
            open={open}
            setOpen={setOpen}
            flaggedRow={flagged(seedRowPath('relationships', id))}
            onRemove={() => remove(index)}
            onIdChange={(next) => replace(index, { ...row, id: next })}
          >
            <EntityPicker
              label="from"
              value={row.from_id ?? null}
              choices={endpoints}
              flagged={flagged(seedRowPath('relationships', id, 'from_id'))}
              onChange={(from_id) => replace(index, { ...row, from_id: from_id ?? '' })}
            />
            <EntityPicker
              label="to"
              value={row.to_id ?? null}
              choices={endpoints}
              flagged={flagged(seedRowPath('relationships', id, 'to_id'))}
              onChange={(to_id) => replace(index, { ...row, to_id: to_id ?? '' })}
            />
            <TextField
              label="kind"
              table="relationship"
              column="kind"
              value={row.kind ?? ''}
              onChange={(kind) => replace(index, { ...row, kind })}
              hint="the structural fact — stepmother of, employer of, owns"
            />
            <TextField
              label="sentiment"
              table="relationship"
              column="sentiment"
              value={row.sentiment ?? ''}
              onChange={(sentiment) =>
                replace(index, { ...row, sentiment: sentiment === '' ? null : sentiment })
              }
              hint="volitional: how they feel about it is proposed, never auto-committed"
            />
            <BagEditor
              bag={row.bag as Record<string, BagValue> | undefined}
              onChange={(bag) => replace(index, { ...row, bag })}
            />
          </EntityCard>
        );
      })}
      <AddRow
        noun="relationship"
        named={false}
        onAdd={() => add({ from_id: '', to_id: '', kind: '', bag: {} }, '')}
      />
    </>
  );
}

// --- Seeded character knowledge -----------------------------------------------------------

function KnowledgeRows({
  seed,
  pkg,
  open,
  setOpen,
  flagged,
  writeSeed,
  table,
}: RowsProps & { pkg: DraftStoryPackage }) {
  const rows = seed.character_knowledge ?? [];
  const { replace, remove, add } = useRowOps(rows, seed, table, writeSeed, setOpen);
  const characters = entityChoices(seed, ['character']);
  const scenes = sceneChoices(pkg.scene_cards);

  return (
    <>
      <p className="lede">
        Rarely needed. A row here means a character starts the story already knowing something —
        everything else they learn, they learn in a scene, and the engine records it there.
      </p>
      {rows.length === 0 ? <Empty noun="seeded knowledge" /> : null}
      {rows.map((row, index) => {
        const id = row.id ?? '';
        return (
          <EntityCard
            key={index}
            id={id}
            name={row.fact_ref ?? ''}
            subtitle={row.character_id ?? ''}
            open={open}
            setOpen={setOpen}
            flaggedRow={flagged(seedRowPath('character_knowledge', id))}
            onRemove={() => remove(index)}
            onIdChange={(next) => replace(index, { ...row, id: next })}
          >
            <EntityPicker
              label="who knows it"
              value={row.character_id ?? null}
              choices={characters}
              flagged={flagged(seedRowPath('character_knowledge', id, 'character_id'))}
              onChange={(character_id) => replace(index, { ...row, character_id: character_id ?? '' })}
            />
            <TextField
              label="fact"
              value={row.fact_ref ?? ''}
              onChange={(fact_ref) => replace(index, { ...row, fact_ref })}
              hint="the fact reference scenes use to plant and pay off — a stable name, not prose"
            />
            <EntityPicker
              label="learned at scene"
              value={row.learned_at_scene ?? null}
              choices={scenes}
              allowNone
              noneLabel="— known from the seed, true from the start —"
              onChange={(learned_at_scene) => replace(index, { ...row, learned_at_scene })}
            />
            <BagEditor
              bag={row.bag as Record<string, BagValue> | undefined}
              onChange={(bag) => replace(index, { ...row, bag })}
            />
          </EntityCard>
        );
      })}
      <AddRow
        noun="known fact"
        named={false}
        onAdd={() => add({ character_id: '', fact_ref: '', bag: {} }, '')}
      />
    </>
  );
}
