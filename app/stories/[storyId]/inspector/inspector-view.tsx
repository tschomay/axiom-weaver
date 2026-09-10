'use client';

import { useEffect, useState } from 'react';
import type { InspectorPayload } from '@/draft/inspector';
import type { Character, Relationship, StoryObject } from '@/schema/story-package';

type Tab = 'world' | 'told';

function bagLine(bag: Record<string, unknown>): string | null {
  const entries = Object.entries(bag);
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(' · ');
}

export function InspectorView({
  storyId,
  sceneCards,
  initial,
}: {
  storyId: string;
  sceneCards: Array<{ id: string; order: number }>;
  initial: InspectorPayload;
}) {
  const lastScene = sceneCards.at(-1)?.order ?? 0;
  const [sceneIndex, setSceneIndex] = useState<number>(initial.as_of_scene ?? lastScene);
  const [payload, setPayload] = useState<InspectorPayload>(initial);
  const [tab, setTab] = useState<Tab>('world');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    // Dragging the scrubber fires an onChange per step; the delay lets a drag settle before the
    // read, and an in-flight read for a position the author has already left is abandoned.
    const timer = setTimeout(() => {
      setLoading(true);
      void fetch(`/api/stories/${storyId}/inspector?scene=${sceneIndex}`, {
        signal: controller.signal,
      })
        .then((response) => response.json() as Promise<InspectorPayload>)
        .then((body) => setPayload(body))
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 120);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [sceneIndex, storyId]);

  const card = sceneCards.find((scene) => scene.order === sceneIndex) ?? null;
  const compiled = payload.compiled_scenes.includes(sceneIndex);
  const model = payload.world_model;

  return (
    <>
      <h2>World &amp; Discourse inspector</h2>
      <p className="meta">
        State as of a scene, reconstructed rather than stored: the World Model is the seed replayed
        through the state-update commit log (ADR 0016 §2), the told-ledger is the Working Draft&apos;s
        Scene Digests replayed in order.
      </p>

      <div className="scrubber">
        <span>scene 0</span>
        <input
          type="range"
          min={0}
          max={lastScene}
          value={sceneIndex}
          onChange={(event) => setSceneIndex(Number.parseInt(event.target.value, 10))}
          aria-label="Scene index"
        />
        <span>scene {lastScene}</span>
        <strong>
          {sceneIndex === 0 ? 'seed — nothing told yet' : `as of ${card?.id ?? `scene ${sceneIndex}`}`}
        </strong>
        {sceneIndex > 0 && !compiled && <span className="tag">not compiled</span>}
        {loading && <span className="meta">reading…</span>}
      </div>

      <p className="meta">
        {payload.compiled_scenes.length} scene(s) compiled in the draft · {payload.log_entries}{' '}
        commit-log entries
      </p>

      <div className="tabs">
        <button
          type="button"
          className={tab === 'world' ? 'action primary' : 'action'}
          onClick={() => setTab('world')}
        >
          World Model
        </button>
        <button
          type="button"
          className={tab === 'told' ? 'action primary' : 'action'}
          onClick={() => setTab('told')}
        >
          Told-ledger
        </button>
      </div>

      {tab === 'world' ? (
        <div className="table-scroll">
          <EntityTable
            heading="Characters"
            columns={['name', 'location_id', 'status', 'goal']}
            rows={Object.values(model.character) as Character[]}
          />
          <EntityTable
            heading="Objects"
            columns={['name', 'location_id', 'status']}
            rows={Object.values(model.object) as StoryObject[]}
          />
          <EntityTable heading="Locations" columns={['name']} rows={Object.values(model.location)} />

          <h3>Relationships</h3>
          <table className="rows">
            <tbody>
              <tr>
                <th>edge</th>
                <th>kind</th>
                <th>sentiment</th>
              </tr>
              {(Object.values(model.relationship) as Relationship[]).map((edge) => (
                <tr key={edge.id}>
                  <td>
                    <code>
                      {edge.from_id} → {edge.to_id}
                    </code>
                  </td>
                  <td>{edge.kind}</td>
                  <td>{edge.sentiment ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Character knowledge</h3>
          {Object.keys(model.character_knowledge).length === 0 ? (
            <p className="meta">No in-world knowledge rows as of this scene.</p>
          ) : (
            <table className="rows">
              <tbody>
                <tr>
                  <th>character</th>
                  <th>fact</th>
                  <th>learned at</th>
                </tr>
                {Object.values(model.character_knowledge).map((known) => (
                  <tr key={known.id}>
                    <td>
                      <code>{known.character_id}</code>
                    </td>
                    <td>
                      <code>{known.fact_ref}</code>
                    </td>
                    <td>{known.learned_at_scene ?? 'seed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <h3>Told-ledger</h3>
          <p className="meta">
            What the <em>reader</em> has been told, and how recently — a different table from
            character knowledge, which is what a character knows in-world.
          </p>
          {payload.told_ledger.length === 0 ? (
            <p className="meta">
              Nothing has been told yet. The ledger fills as scenes are compiled — a fact enters it
              by having been told, not by a card intending to tell it.
            </p>
          ) : (
            <table className="rows">
              <tbody>
                <tr>
                  <th>fact</th>
                  <th>first learned</th>
                  <th>last touched</th>
                  <th>centrality</th>
                </tr>
                {payload.told_ledger.map((row) => (
                  <tr key={row.fact_ref}>
                    <td>
                      <code>{row.fact_ref}</code>
                    </td>
                    <td>scene {row.first_learned_scene}</td>
                    <td>scene {row.last_touched_scene}</td>
                    <td>
                      <span className="tag">{row.centrality}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <h3>Committed at this scene</h3>
      {payload.changes_at_scene.length === 0 ? (
        <p className="meta">Nothing was committed to the World Model at this scene.</p>
      ) : (
        <div className="table-scroll">
          <table className="rows">
            <tbody>
              <tr>
                <th>field</th>
                <th>from</th>
                <th>to</th>
                <th>status</th>
              </tr>
              {payload.changes_at_scene.map((entry) => (
                <tr key={entry.sequence}>
                  <td>
                    <code>
                      {entry.entity_id}.{entry.column}
                    </code>
                  </td>
                  <td>{JSON.stringify(entry.previous_value)}</td>
                  <td>{JSON.stringify(entry.new_value)}</td>
                  <td>
                    <span
                      className={
                        entry.status === 'proposed'
                          ? 'tag warn'
                          : entry.status === 'proposed_dropped'
                            ? 'tag'
                            : 'tag good'
                      }
                    >
                      {entry.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta">
            The log is append-only, so recompiling a scene adds what it decided rather than
            rewriting what an earlier compile decided — one field can appear here more than once,
            and the last entry is the one replay leaves standing.
          </p>
        </div>
      )}
    </>
  );
}

function EntityTable({
  heading,
  columns,
  rows,
}: {
  heading: string;
  columns: string[];
  rows: Array<{ id: string; bag: Record<string, unknown> }>;
}) {
  return (
    <>
      <h3>{heading}</h3>
      <table className="rows">
        <tbody>
          <tr>
            <th>id</th>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
          {rows.map((row) => {
            const bag = bagLine(row.bag);
            return (
              <tr key={row.id}>
                <td>
                  <code>{row.id}</code>
                  {bag !== null && (
                    <>
                      <br />
                      <span className="meta">{bag}</span>
                    </>
                  )}
                </td>
                {columns.map((column) => (
                  <td key={column}>
                    {String((row as Record<string, unknown>)[column] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
