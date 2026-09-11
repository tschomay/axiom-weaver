'use client';

import { useState } from 'react';
import type { DraftSceneCard, DraftStoryPackage } from '@/schema/manuscript';
import {
  addSceneCard,
  deleteSceneCard,
  inOrder,
  moveScene,
  plantDependents,
  scenePath,
} from '@/authoring/scene-editor';
import { SceneCardEditor } from './scene-card-editor';

/**
 * The Syuzhet: which scenes are told, in what order, and what each one is responsible for.
 *
 * Desktop shows the list and the open card together; a narrow viewport drills list → one scene,
 * with the open scene in the URL so the back gesture is the way out (ADR 0017 §7). The section
 * itself is already one drill-down level deep, which makes this the third — and the URL carries
 * both, so a link is to a scene and not just to a screen.
 */
export function ScenesSection({
  pkg,
  onChange,
  flagged,
  problemsFor,
  openSceneId,
  onOpenScene,
}: {
  pkg: DraftStoryPackage;
  onChange: (next: DraftStoryPackage) => void;
  flagged: (path: string) => boolean;
  problemsFor: (prefix: string) => number;
  openSceneId: string | null;
  onOpenScene: (sceneId: string | null) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const scenes = inOrder(pkg.scene_cards);
  const open = scenes.find((scene) => scene.id === openSceneId) ?? null;

  const writeScenes = (next: DraftSceneCard[]) => onChange({ ...pkg, scene_cards: next });

  const replaceScene = (sceneId: string, next: DraftSceneCard) =>
    writeScenes(pkg.scene_cards.map((scene) => (scene.id === sceneId ? next : scene)));

  return (
    <section>
      <div className={open === null ? 'scenes-shell' : 'scenes-shell at-scene'}>
        <div className="scene-list">
          <h2>Scene Cards</h2>

          {scenes.length === 0 ? (
            <p className="empty-note">
              No scenes yet. Nothing is wrong — a story starts here. A package needs at least one
              Scene Card before it can publish, so the linter will keep saying so until there is
              one.
            </p>
          ) : null}

          {scenes.map((scene, index) => {
            const problems = problemsFor(scenePath(scene.id));
            return (
              <div
                className={scene.id === openSceneId ? 'scene-row selected' : 'scene-row'}
                key={scene.id}
              >
                <span className="num">{scene.order}</span>
                <button
                  type="button"
                  className="scene-open"
                  onClick={() => onOpenScene(scene.id)}
                >
                  <span className="title">{scene.id === '' ? '(no id)' : scene.id}</span>
                  <span className="meta">
                    {scene.pov === '' ? 'no pov' : scene.pov}
                    {scene.location_id === '' ? '' : ` · ${scene.location_id}`}
                  </span>
                </button>
                {problems === 0 ? null : (
                  <span className="tag bad">
                    {problems} problem{problems === 1 ? '' : 's'}
                  </span>
                )}
                <span className="actions">
                  <button
                    type="button"
                    className="tiny"
                    aria-label={`move ${scene.id} earlier`}
                    disabled={index === 0}
                    onClick={() => writeScenes(moveScene(pkg.scene_cards, scene.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="tiny"
                    aria-label={`move ${scene.id} later`}
                    disabled={index === scenes.length - 1}
                    onClick={() => writeScenes(moveScene(pkg.scene_cards, scene.id, 1))}
                  >
                    ↓
                  </button>
                </span>
              </div>
            );
          })}

          <div className="row-actions">
            <button
              type="button"
              className="action"
              onClick={() => {
                const added = addSceneCard(pkg.scene_cards, { kind: 'blank' });
                writeScenes(added.scenes);
                onOpenScene(added.id);
              }}
            >
              Add a scene
            </button>
          </div>

          <p className="meta">
            Reordering rewrites <code>order</code> across the list. A <code>pays_off</code> that
            named an earlier scene may stop being earlier, and the linter says so as soon as it
            does.
          </p>
        </div>

        <div className="scene-body">
          {open === null ? (
            <p className="empty-note scene-placeholder">
              Pick a scene to edit it.
            </p>
          ) : (
            <>
              <p className="section-back">
                <button type="button" className="tiny" onClick={() => onOpenScene(null)}>
                  ← all scenes
                </button>
              </p>

              <h2>{open.id}</h2>

              <div className="row-actions">
                <button
                  type="button"
                  className="tiny"
                  onClick={() => {
                    const added = addSceneCard(pkg.scene_cards, {
                      kind: 'duplicated-from',
                      scene: open,
                    });
                    writeScenes(added.scenes);
                    onOpenScene(added.id);
                  }}
                >
                  duplicate this scene
                </button>
                <button
                  type="button"
                  className="tiny"
                  onClick={() => setConfirmDelete(open.id)}
                >
                  delete this scene
                </button>
              </div>

              {confirmDelete === open.id ? (
                <DeleteConfirm
                  scene={open}
                  pkg={pkg}
                  onCancel={() => setConfirmDelete(null)}
                  onConfirm={() => {
                    writeScenes(deleteSceneCard(pkg.scene_cards, open.id));
                    setConfirmDelete(null);
                    onOpenScene(null);
                  }}
                />
              ) : null}

              <SceneCardEditor
                scene={open}
                pkg={pkg}
                flagged={flagged}
                onChange={(next) => {
                  replaceScene(open.id, next);
                  if (next.id !== open.id) onOpenScene(next.id);
                }}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Deleting a card that something else plants at.
 *
 * Said before the delete rather than reported by the linter after it: the author can still change
 * their mind while the card is in front of them, and `plant_scene_unknown` two screens later is
 * the same information at a worse moment.
 */
function DeleteConfirm({
  scene,
  pkg,
  onCancel,
  onConfirm,
}: {
  scene: DraftSceneCard;
  pkg: DraftStoryPackage;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dependents = plantDependents(pkg.scene_cards, scene.id);

  return (
    <div className="panel">
      <h3>Delete {scene.id}?</h3>
      {dependents.length === 0 ? (
        <p className="meta">No other card names this one as a plant.</p>
      ) : (
        <>
          <p>
            {dependents.length} payoff{dependents.length === 1 ? '' : 's'} plant
            {dependents.length === 1 ? 's' : ''} here. Deleting this card leaves{' '}
            {dependents.length === 1 ? 'it' : 'them'} naming a scene that no longer exists, which
            blocks publishing until you repoint or remove{' '}
            {dependents.length === 1 ? 'it' : 'them'}.
          </p>
          <ul className="paths">
            {dependents.map((dependent) => (
              <li key={`${dependent.payoff_scene_id}.${dependent.fact_ref}`} className="meta">
                {dependent.payoff_scene_id} pays off {dependent.fact_ref}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row-actions">
        <button type="button" className="action" onClick={onConfirm}>
          Delete it
        </button>
        <button type="button" className="action" onClick={onCancel}>
          Keep it
        </button>
      </div>
    </div>
  );
}
