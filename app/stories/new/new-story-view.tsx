'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { slugifyStoryId } from '@/authoring/story-id';
import { AuthorTokenField, useAuthorSession } from '../../author-token';
import { useStoryIdCheck } from '../[storyId]/edit/use-story-id-check';

export interface DuplicableStory {
  storyId: string;
  title: string;
  currentVersion: number;
  retainedVersions: number[];
  scenes: number;
}

/**
 * Two of ADR 0017 §5's three entry points. (The third, Edit, starts from a story that exists.)
 *
 * Duplicate is the one that carries weight: it is what makes the five fixtures function as
 * templates. Starting from a story with a complete plant chain and a filled Voice Card is a
 * categorically easier first hour than starting from an empty seed, and it needs no template
 * system to exist.
 */
export function NewStoryView({ stories }: { stories: DuplicableStory[] }) {
  const router = useRouter();
  const session = useAuthorSession();

  const [mode, setMode] = useState<'new' | 'duplicate'>('new');
  const [title, setTitle] = useState('');
  const [storyId, setStoryId] = useState('');
  const [touchedId, setTouchedId] = useState(false);
  const [from, setFrom] = useState(stories[0]?.storyId ?? '');
  // `null` means "whatever that story's current version is" — so switching source stories does
  // not need an effect to move a version number that was only ever a default.
  const [pickedVersion, setPickedVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The id follows the title until the author edits it, and stops following the moment they do.
  const effectiveId = touchedId ? storyId : slugifyStoryId(title);
  const availability = useStoryIdCheck(effectiveId, true);

  const source = stories.find((story) => story.storyId === from);
  const version = pickedVersion ?? source?.currentVersion ?? null;

  const ready =
    session.canWrite &&
    !busy &&
    availability === 'free' &&
    (mode === 'new' ? title.trim() !== '' : source !== undefined && version !== null);

  const create = () => {
    setBusy(true);
    setError(null);
    void fetch('/api/manuscripts', {
      method: 'POST',
      headers: session.headers(),
      body: JSON.stringify(
        mode === 'new'
          ? { source: 'new', title: title.trim(), story_id: effectiveId }
          : {
              source: 'duplicate',
              from_story_id: from,
              from_version: version,
              story_id: effectiveId,
              ...(title.trim() === '' ? {} : { title: title.trim() }),
            },
      ),
    })
      .then(async (response) => {
        const body = (await response.json()) as { story_id?: string; error?: string };
        if (response.ok && body.story_id !== undefined) {
          router.push(`/stories/${body.story_id}/edit?section=story`);
          return;
        }
        setError(body.error ?? `could not start the story (${response.status})`);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'could not start the story'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <main>
      <p className="meta">
        <Link href="/">← stories</Link>
      </p>
      <h1>Start a story</h1>
      <p className="lede">
        Either way you get a draft. Nothing is published until you publish it, and a draft is the
        only thing your edits touch.
      </p>

      <AuthorTokenField session={session} />

      <div className="entity-tabs">
        <button
          type="button"
          className={mode === 'new' ? 'action primary' : 'action'}
          onClick={() => setMode('new')}
        >
          From scratch
        </button>
        <button
          type="button"
          className={mode === 'duplicate' ? 'action primary' : 'action'}
          disabled={stories.length === 0}
          onClick={() => setMode('duplicate')}
        >
          Duplicate an existing story
        </button>
      </div>

      {mode === 'duplicate' ? (
        stories.length === 0 ? (
          <p className="empty-note">Nothing published yet, so there is nothing to duplicate.</p>
        ) : (
          <>
            <div className="field">
              <label>
                <span className="label-text">Start from</span>
                <select
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setPickedVersion(null);
                  }}
                >
                  {stories.map((story) => (
                    <option key={story.storyId} value={story.storyId}>
                      {story.title} — {story.scenes} scene{story.scenes === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field">
              <label>
                <span className="label-text">Which version</span>
                <select
                  value={version ?? ''}
                  onChange={(event) => setPickedVersion(Number(event.target.value))}
                >
                  {(source?.retainedVersions ?? []).map((retained) => (
                    <option key={retained} value={retained}>
                      package_version {retained}
                      {retained === source?.currentVersion ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <span className="hint">
                Only the package travels. No Working Draft, no compiled scenes, no runs, no
                editions — the copy starts at package_version 1 with nothing published.
              </span>
            </div>
          </>
        )
      ) : null}

      <div className="field">
        <label>
          <span className="label-text">Title</span>
          <input
            type="text"
            value={title}
            placeholder={mode === 'duplicate' ? `${source?.title ?? ''} (copy)` : 'The Dragon of…'}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      </div>

      <div className="field">
        <label>
          <span className="label-text">story id</span>
          <input
            type="text"
            value={effectiveId}
            spellCheck={false}
            placeholder="slugged from the title"
            onChange={(event) => {
              setTouchedId(true);
              setStoryId(slugifyStoryId(event.target.value));
            }}
          />
        </label>
        <span className="hint">
          {effectiveId === ''
            ? 'Follows the title until you change it.'
            : availability === 'free'
              ? 'Available. You can still change it right up until the first publish — after that it keys every retained version and stays fixed.'
              : availability === 'taken'
                ? 'Already a story. Pick another.'
                : availability === 'invalid'
                  ? 'Not a usable id — lowercase letters, digits and hyphens, and not one the app reserves.'
                  : 'Checking…'}
        </span>
      </div>

      <div className="row-actions">
        <button type="button" className="action primary" disabled={!ready} onClick={create}>
          {mode === 'new' ? 'Create the draft' : 'Duplicate into a new draft'}
        </button>
      </div>

      {error === null ? null : <p className="admin-error">{error}</p>}
    </main>
  );
}
