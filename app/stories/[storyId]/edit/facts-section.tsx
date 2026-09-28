'use client';

import type { DraftStoryPackage } from '@/schema/manuscript';
import type { Fact } from '@/schema/story-package';
import {
  causalPreview,
  draftFacts,
  unstatedFactRefs,
  withFacts,
  type EntityChoice,
} from '@/authoring/editor-model';
import { EntityMultiPicker, TextField } from './controls';

/**
 * The facts table (ADR 0022): the claim each `fact_ref` stands for, and what it follows from.
 *
 * The slug stays the identity every mechanism matches on; a statement is what the writer reads
 * beside it, and `caused_by` is what orders a retelling. So the causes are picked from the table,
 * never typed — a cause that is not a row is a `fact_unknown_cause` error, and a control that
 * cannot produce one is better than a lint that reports it.
 */
export function FactsSection({
  pkg,
  onChange,
  flagged,
}: {
  pkg: DraftStoryPackage;
  onChange: (next: DraftStoryPackage) => void;
  flagged: (path: string) => boolean;
}) {
  const facts = draftFacts(pkg);
  const unstated = unstatedFactRefs(pkg);
  const preview = causalPreview(facts);
  const write = (next: readonly Fact[]) => onChange(withFacts(pkg, next));
  const update = (index: number, patch: Partial<Fact>) =>
    write(facts.map((fact, at) => (at === index ? { ...fact, ...patch } : fact)));

  return (
    <section>
      <h2>Facts</h2>
      <p className="lede">
        What each fact slug actually claims, and which facts it follows from. The writer sees the
        statement beside the slug wherever it appears, and when a scene touches linked facts it gets
        the whole chain in cause-before-effect order — so a scene that retells what happened
        paraphrases this account instead of rebuilding it.
      </p>

      {facts.length === 0 ? (
        <p className="empty-note">
          No statements yet. A story publishes fine without them — the writer then sees only the
          slugs.
        </p>
      ) : null}

      {facts.map((fact, index) => {
        const choices: EntityChoice[] = facts
          .filter((other, at) => at !== index && other.fact_ref !== '')
          .map((other) => ({ id: other.fact_ref, label: other.fact_ref, table: 'character' }));
        const path = `facts["${fact.fact_ref}"]`;
        return (
          <div className="proposal" key={index}>
            <div className="body">
              <TextField
                label="Fact slug"
                value={fact.fact_ref}
                placeholder="the_will_was_forged"
                flagged={flagged(path)}
                hint="the same slug the Scene Cards use"
                onChange={(fact_ref) => update(index, { fact_ref })}
              />
              <TextField
                label="Statement"
                value={fact.statement}
                multiline
                placeholder="The will was forged by the nephew, after the old man died."
                hint="one plain sentence, with its direction explicit — a claim, never a topic"
                onChange={(statement) => update(index, { statement })}
              />
              <EntityMultiPicker
                label="Caused by"
                values={fact.caused_by}
                choices={choices}
                hint="the facts this one follows FROM — causes, not merely earlier facts"
                onChange={(caused_by) => update(index, { caused_by })}
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="tiny"
                onClick={() =>
                  write(
                    facts
                      .filter((_, at) => at !== index)
                      // A removed fact can no longer be anyone's cause.
                      .map((other) => ({
                        ...other,
                        caused_by: other.caused_by.filter((cause) => cause !== fact.fact_ref),
                      })),
                  )
                }
              >
                remove
              </button>
            </div>
          </div>
        );
      })}

      <div className="row-actions">
        <select
          value=""
          aria-label="add a statement for a fact the cards use"
          disabled={unstated.length === 0}
          onChange={(event) => {
            if (event.target.value === '') return;
            write([...facts, { fact_ref: event.target.value, statement: '', caused_by: [] }]);
          }}
        >
          <option value="">
            {unstated.length === 0
              ? '— every fact the cards use has a statement —'
              : `— state a fact the cards use (${unstated.length}) —`}
          </option>
          {unstated.map((ref) => (
            <option key={ref} value={ref}>
              {ref}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="tiny"
          onClick={() => write([...facts, { fact_ref: '', statement: '', caused_by: [] }])}
        >
          add a new fact
        </button>
      </div>
      <p className="hint">
        A new fact need not appear on any card — the steps of a hidden incident the reader only
        hears about later are facts too, and linking them is what keeps a retelling in order.
      </p>

      {preview.length > 0 ? (
        <>
          <h3>As the writer will read it</h3>
          <p className="meta">Linked facts, causes before effects.</p>
          <ol>
            {preview.map((fact) => (
              <li key={fact.fact_ref}>
                <code>{fact.fact_ref}</code> — {fact.statement}
                {fact.caused_by.length > 0 ? (
                  <span className="meta"> (because of: {fact.caused_by.join(', ')})</span>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
