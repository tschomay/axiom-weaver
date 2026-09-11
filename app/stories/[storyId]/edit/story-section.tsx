'use client';

import { useState } from 'react';
import type { DraftStoryPackage } from '@/schema/manuscript';
import { slugifyStoryId } from '@/authoring/story-id';
import { TextField } from './controls';
import { useStoryIdCheck } from './use-story-id-check';

/**
 * Title, source, and the one field with a deadline on it.
 *
 * `story_id` keys every blob path the story owns, so it is editable up to the first publish and
 * fixed forever after (ADR 0017 §5). The screen says which of the two it is *before* the author
 * publishes — a constraint discovered afterwards is a constraint that has already cost something.
 *
 * It is also the one field autosave does not touch. Every other edit is debounced into a save a
 * second later; a debounced *rename* would move the story once per keystroke, so this one waits
 * for a button.
 */
export function StorySection({
  pkg,
  onChange,
  renameable,
  onRename,
  flagged,
  busy,
}: {
  pkg: DraftStoryPackage;
  onChange: (next: DraftStoryPackage) => void;
  renameable: boolean;
  onRename: (next: string) => Promise<string | null>;
  flagged: (path: string) => boolean;
  busy: boolean;
}) {
  // `null` means "following the stored id", which is what makes a completed rename settle without
  // an effect syncing local state back to the prop.
  const [typedId, setTypedId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const draftId = typedId ?? pkg.story_id;
  const changed = draftId !== pkg.story_id;
  const verdict = useStoryIdCheck(draftId, renameable && changed);

  const metadata = pkg.metadata;

  return (
    <section>
      <h2>Story</h2>

      <TextField
        label="Title"
        value={metadata.title ?? ''}
        flagged={flagged('metadata.title')}
        onChange={(title) => onChange({ ...pkg, metadata: { ...metadata, title } })}
        hint="what the story is called — the only metadata field the schema requires"
      />

      <TextField
        label="Source"
        value={typeof metadata.source === 'string' ? metadata.source : ''}
        onChange={(source) => onChange({ ...pkg, metadata: { ...metadata, source } })}
        hint="where the material came from, if anywhere — a folk tale, a public-domain text, nothing"
      />

      <div className={flagged('story_id') ? 'field flagged' : 'field'}>
        <label>
          <span className="label-text">story id</span>
          <input
            type="text"
            value={draftId}
            spellCheck={false}
            disabled={!renameable}
            onChange={(event) => setTypedId(slugifyStoryId(event.target.value))}
          />
        </label>
        {renameable ? (
          <>
            <span className="hint">
              Lowercase letters, digits and hyphens. Editable until this story publishes for the
              first time — after that it keys every retained version, and any edition pinned to
              one, so it is fixed.
            </span>
            {changed ? (
              <div className="row-actions">
                <button
                  type="button"
                  className="action"
                  disabled={busy || verdict !== 'free'}
                  onClick={() => {
                    setRenameError(null);
                    void onRename(draftId).then((error) => {
                      setRenameError(error);
                      if (error === null) setTypedId(null);
                    });
                  }}
                >
                  Rename to {draftId}
                </button>
                <span className="meta">
                  {verdict === 'free'
                    ? 'available'
                    : verdict === 'taken'
                      ? 'already a story'
                      : verdict === 'invalid'
                        ? 'not a usable id'
                        : 'checking…'}
                </span>
              </div>
            ) : null}
            {renameError === null ? null : <p className="admin-error">{renameError}</p>}
          </>
        ) : (
          <span className="hint">
            Fixed: this story has published, and retained versions — plus any edition pinned to one
            — are addressed by this id.
          </span>
        )}
      </div>

      <p className="meta">
        schema_version {pkg.schema_version}
        {typeof metadata.created_at === 'string' ? ` · created ${metadata.created_at}` : ''}
      </p>
    </section>
  );
}
