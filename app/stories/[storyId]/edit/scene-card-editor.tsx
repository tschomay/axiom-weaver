'use client';

import type { DraftSceneCard, DraftStoryPackage } from '@/schema/manuscript';
import { entityChoices } from '@/authoring/editor-model';
import {
  PAYOFF_STATUS_MESSAGES,
  factRefsInUse,
  payoffStatus,
  plantChoices,
  scenePath,
} from '@/authoring/scene-editor';
import { EntityMultiPicker, EntityPicker, Field, StringListField, TextField } from './controls';
import { StateEditor } from './state-editor';

/**
 * One Scene Card.
 *
 * Eight required fields and seven optional ones. The three that decide whether a telling holds
 * together — `pays_off`, `entry_state` and `exit_state` — get the most structure, because that is
 * where #18 and #16 measured hand-authoring going wrong.
 */
export function SceneCardEditor({
  scene,
  pkg,
  onChange,
  flagged,
}: {
  scene: DraftSceneCard;
  pkg: DraftStoryPackage;
  onChange: (next: DraftSceneCard) => void;
  flagged: (path: string) => boolean;
}) {
  const seed = pkg.world_model_seed;
  const characters = entityChoices(seed, ['character']);
  const locations = entityChoices(seed, ['location']);
  const facts = factRefsInUse(pkg);

  const set = (patch: Partial<DraftSceneCard>) => onChange({ ...scene, ...patch });

  return (
    <>
      <datalist id="fact-refs">
        {facts.map((fact) => (
          <option key={fact} value={fact} />
        ))}
      </datalist>

      <TextField
        label="id"
        value={scene.id}
        onChange={(id) => set({ id })}
        hint="what every pays_off that plants here names — renaming it does not rename those references"
        flagged={flagged(scenePath(scene.id, 'id'))}
      />

      <EntityPicker
        label="point of view"
        value={scene.pov === '' ? null : scene.pov}
        choices={characters}
        flagged={flagged(scenePath(scene.id, 'pov'))}
        onChange={(pov) => set({ pov: pov ?? '' })}
      />

      <EntityPicker
        label="location"
        value={scene.location_id === '' ? null : scene.location_id}
        choices={locations}
        flagged={flagged(scenePath(scene.id, 'location_id'))}
        onChange={(location_id) => set({ location_id: location_id ?? '' })}
      />

      <EntityMultiPicker
        label="characters present"
        values={scene.characters_present}
        choices={characters}
        flagged={flagged(scenePath(scene.id, 'characters_present'))}
        hint="everyone in the room, the point-of-view character included"
        onChange={(characters_present) => set({ characters_present })}
      />

      <TextField
        label="dramatic function"
        value={scene.dramatic_function}
        multiline
        onChange={(dramatic_function) => set({ dramatic_function })}
        hint="what this scene is for — the job it does in the story, not what happens in it"
      />

      <TextField
        label="tone"
        value={scene.tone ?? ''}
        onChange={(tone) => set({ tone: tone === '' ? undefined : tone })}
        hint="this scene only: it shapes emphasis within the Voice Card, and never overrides it"
      />

      <Field
        label="length budget"
        hint="words, roughly. Left empty, the writer is given no target."
      >
        <input
          type="number"
          min={1}
          value={scene.length_budget ?? ''}
          onChange={(event) =>
            set({
              length_budget:
                event.target.value === '' ? undefined : Math.max(1, Number(event.target.value)),
            })
          }
        />
      </Field>

      <StringListField
        label="required beats"
        values={scene.required_beats}
        multiline
        placeholder="what has to happen"
        hint="the events the scene must contain. The writer may not skip one."
        onChange={(required_beats) => set({ required_beats })}
      />

      <StringListField
        label="invariants"
        values={scene.invariants}
        multiline
        placeholder="what must stay true"
        onChange={(invariants) => set({ invariants })}
      />

      <FactList
        label="reader must learn"
        hint="facts this scene puts in front of the reader. A later payoff can only name this scene as its plant if the fact is listed here."
        values={scene.reader_must_learn}
        onChange={(reader_must_learn) => set({ reader_must_learn })}
      />

      <FactList
        label="must stay hidden"
        hint="facts the reader must not be given yet, however much the scene knows them"
        values={scene.must_stay_hidden}
        onChange={(must_stay_hidden) => set({ must_stay_hidden })}
      />

      <FactList
        label="force reintroduce"
        hint="what to reintroduce because the reader has probably lost it"
        values={scene.force_reintroduce}
        onChange={(force_reintroduce) => set({ force_reintroduce })}
      />

      <PaysOff scene={scene} pkg={pkg} onChange={onChange} />

      <StateEditor
        label="Entry state"
        hint="what this scene asserts is already true when it opens"
        state={scene.entry_state}
        sceneId={scene.id}
        pkg={pkg}
        onChange={(entry_state) => set({ entry_state })}
      />

      <StateEditor
        label="Exit state"
        hint="what this scene changes, and the rows it creates"
        state={scene.exit_state}
        sceneId={scene.id}
        pkg={pkg}
        onChange={(exit_state) => set({ exit_state })}
      />
    </>
  );
}

/**
 * A list of fact refs, each suggesting the ones the package already uses.
 *
 * A fact ref is a free slug with no table behind it, so a typo is not something the schema can
 * catch — it is a plant chain that silently never closes. Suggestion is the cheapest thing that
 * makes reusing an existing ref easier than retyping one.
 */
function FactList({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label={label} hint={hint} group>
      {values.length === 0 ? <span className="hint">none</span> : null}
      {values.map((value, index) => (
        // Keyed by position: the value is what the author is editing.
        <div className="list-row" key={index}>
          <input
            type="text"
            list="fact-refs"
            aria-label={`${label} ${index + 1}`}
            spellCheck={false}
            value={value}
            placeholder="a_fact_ref"
            onChange={(event) =>
              onChange(values.map((old, at) => (at === index ? event.target.value : old)))
            }
          />
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
 * `pays_off`: `{fact_ref, plant}` pairs.
 *
 * The plant picker offers **earlier scenes only**, and says beside each whether that scene's own
 * `reader_must_learn` declares the fact — because ADR 0004 decision 2 rejects the pair if it does
 * not, and the author can fix it here in one move instead of reading an error later.
 */
function PaysOff({
  scene,
  pkg,
  onChange,
}: {
  scene: DraftSceneCard;
  pkg: DraftStoryPackage;
  onChange: (next: DraftSceneCard) => void;
}) {
  const entries = scene.pays_off;
  const write = (next: typeof entries) => onChange({ ...scene, pays_off: next });

  return (
    <Field
      label="pays off"
      group
      hint="facts this scene resolves, each named with where it was planted"
    >
      {entries.length === 0 ? <span className="hint">nothing</span> : null}

      {entries.map((entry, index) => {
        const choices = plantChoices(pkg.scene_cards, scene.id, entry.fact_ref);
        const status = payoffStatus(pkg, scene.id, entry);
        const replace = (patch: Partial<(typeof entries)[number]>) =>
          write(entries.map((old, at) => (at === index ? { ...old, ...patch } : old)));

        return (
          // Keyed by position: one scene may pay off the same fact against two plants.
          <div className={status === 'ok' ? 'payoff' : 'payoff bad'} key={index}>
            <div className="list-row">
              <input
                type="text"
                list="fact-refs"
                aria-label={`payoff ${index + 1} fact`}
                spellCheck={false}
                value={entry.fact_ref}
                placeholder="a_fact_ref"
                onChange={(event) => replace({ fact_ref: event.target.value })}
              />
              <button
                type="button"
                className="tiny"
                onClick={() => write(entries.filter((_, at) => at !== index))}
              >
                remove
              </button>
            </div>

            <select
              aria-label={`payoff ${index + 1} plant`}
              value={entry.plant ?? ''}
              onChange={(event) => replace({ plant: event.target.value === '' ? null : event.target.value })}
            >
              <option value="">grounded in the World Model seed</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                  {choice.declares ? ' — declares it' : ' — does not declare it'}
                </option>
              ))}
              {entry.plant !== null &&
              entry.plant !== undefined &&
              !choices.some((choice) => choice.id === entry.plant) ? (
                <option value={entry.plant}>{entry.plant} — not an earlier scene</option>
              ) : null}
            </select>

            {status === 'ok' ? null : (
              <p className="hint bad-note">{PAYOFF_STATUS_MESSAGES[status]}</p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="tiny"
        onClick={() => write([...entries, { fact_ref: '', plant: null }])}
      >
        add a payoff
      </button>
    </Field>
  );
}
