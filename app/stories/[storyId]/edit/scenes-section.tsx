'use client';

import Link from 'next/link';
import type { DraftStoryPackage } from '@/schema/manuscript';

/**
 * The Scene Card list.
 *
 * The card editor itself is #89 — the state-row builder is most of that ticket and none of this
 * one. What this section owes the author now is the thing a new story makes conspicuous: a story
 * with no scenes is the normal starting state, not a broken one, and every scene-dependent panel
 * has to say so rather than render an empty table.
 */
export function ScenesSection({
  storyId,
  pkg,
  problemsFor,
}: {
  storyId: string;
  pkg: DraftStoryPackage;
  problemsFor: (prefix: string) => number;
}) {
  const scenes = [...pkg.scene_cards].sort((a, b) => a.order - b.order);

  return (
    <section>
      <h2>Scene Cards</h2>
      <p className="lede">
        The Syuzhet: which scenes are told, in what order, and what each one is responsible for.
      </p>

      {scenes.length === 0 ? (
        <p className="empty-note">
          No scenes yet. Nothing is wrong — a story starts here. A package needs at least one Scene
          Card before it can publish, so the linter will keep saying so until there is one.
        </p>
      ) : (
        scenes.map((scene) => {
          const problems = problemsFor(`scene_cards.${scene.id}`);
          return (
            <div className="scene-row" key={scene.id}>
              <span className="num">{scene.order}</span>
              <span className="title">{scene.id === '' ? '(no id)' : scene.id}</span>
              <span className="meta">
                {scene.pov === '' ? 'no pov' : scene.pov}
                {scene.location_id === '' ? '' : ` · ${scene.location_id}`}
              </span>
              {problems === 0 ? null : (
                <span className="tag bad">
                  {problems} problem{problems === 1 ? '' : 's'}
                </span>
              )}
            </div>
          );
        })
      )}

      <p className="meta">
        Editing a card — its beats, its entry and exit state, what it plants and pays off — is the
        Scene Card editor, which lands next. Until then a card&apos;s contents are visible on{' '}
        <Link href={`/stories/${storyId}`}>the Working Draft</Link> and editable through the
        package JSON.
      </p>
    </section>
  );
}
