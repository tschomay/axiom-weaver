'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { slugifyStoryId } from '@/authoring/story-id';
import { AuthorTokenField, useAuthorSession } from '../../author-token';
import { parseImport, type ImportResult } from '@/authoring/transfer';
import { FileOpenButton } from '../[storyId]/edit/controls';
import { useStoryIdCheck } from '../[storyId]/edit/use-story-id-check';

export interface DuplicableStory {
  storyId: string;
  title: string;
  currentVersion: number;
  retainedVersions: number[];
  scenes: number;
}

/**
 * Two of ADR 0017 §5's three entry points, plus §6's escape hatch. (The third entry point, Edit,
 * starts from a story that already exists.)
 *
 * Duplicate is the one that carries weight: it is what makes the five fixtures function as
 * templates. Starting from a story with a complete plant chain and a filled Voice Card is a
 * categorically easier first hour than starting from an empty seed, and it needs no template
 * system to exist.
 */
export function NewStoryView({ stories }: { stories: DuplicableStory[] }) {
  const router = useRouter();
  const session = useAuthorSession();

  const [mode, setMode] = useState<'new' | 'duplicate' | 'import'>('new');
  const [imported, setImported] = useState<ImportResult | null>(null);
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
  // An import proposes the package's own id and title, which the author can still override —
  // the id in a file is a suggestion here, not a claim on a blob path.
  const importedPkg = imported !== null && imported.ok ? imported : null;
  const effectiveTitle =
    title !== '' || importedPkg === null ? title : importedPkg.summary.title;
  const effectiveId = touchedId
    ? storyId
    : importedPkg !== null && title === ''
      ? slugifyStoryId(importedPkg.summary.story_id)
      : slugifyStoryId(title);
  const availability = useStoryIdCheck(effectiveId, true);

  const source = stories.find((story) => story.storyId === from);
  const version = pickedVersion ?? source?.currentVersion ?? null;

  const ready =
    session.canWrite &&
    !busy &&
    availability === 'free' &&
    (mode === 'new'
      ? title.trim() !== ''
      : mode === 'import'
        ? importedPkg !== null && effectiveTitle.trim() !== ''
        : source !== undefined && version !== null);

  /**
   * An import starts as an empty story and is then filled in.
   *
   * Two writes rather than one, deliberately: the package lands in the **Manuscript** through the
   * ordinary save path, which is the only way in that the publish gate sits in front of.
   */
  const createFromImport = async (): Promise<string | null> => {
    if (importedPkg === null) return 'nothing to import';
    const created = await fetch('/api/manuscripts', {
      method: 'POST',
      headers: session.headers(),
      body: JSON.stringify({
        source: 'new',
        title: effectiveTitle.trim(),
        story_id: effectiveId,
      }),
    });
    const seeded = (await created.json()) as {
      story_id?: string;
      updated_at?: string;
      error?: string;
    };
    if (!created.ok || seeded.story_id === undefined || seeded.updated_at === undefined) {
      return seeded.error ?? `could not start the story (${created.status})`;
    }

    const saved = await fetch(`/api/stories/${seeded.story_id}/manuscript`, {
      method: 'PUT',
      headers: session.headers(),
      body: JSON.stringify({
        package: { ...importedPkg.package, story_id: seeded.story_id },
        updated_at: seeded.updated_at,
      }),
    });
    if (!saved.ok) {
      const body = (await saved.json()) as { error?: string };
      return body.error ?? `the story was created but the package did not import (${saved.status})`;
    }
    router.push(`/stories/${seeded.story_id}/edit?section=story`);
    return null;
  };

  const create = () => {
    setBusy(true);
    setError(null);

    if (mode === 'import') {
      void createFromImport()
        .then(setError)
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : 'could not import the story'),
        )
        .finally(() => setBusy(false));
      return;
    }

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
        <button
          type="button"
          className={mode === 'import' ? 'action primary' : 'action'}
          onClick={() => setMode('import')}
        >
          Import a package
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

      {mode === 'import' ? (
        <>
          <p className="lede">
            A Story Package as JSON — one you exported, or a fixture straight out of{' '}
            <code>fixtures/</code>. It lands in the new story&apos;s draft, where you can fix
            whatever the linter finds before publishing.
          </p>

          <div className="row-actions">
            <FileOpenButton onText={(body) => setImported(parseImport(body))} />
          </div>

          <div className="field">
            <label>
              <span className="label-text">or paste it here</span>
              <textarea
                className="import-box"
                spellCheck={false}
                placeholder='{ "schema_version": "1.0", … }'
                onChange={(event) =>
                  setImported(
                    event.target.value.trim() === '' ? null : parseImport(event.target.value),
                  )
                }
              />
            </label>
          </div>

          {imported === null ? null : imported.ok ? (
            <p className="meta">
              {imported.summary.title === '' ? '(untitled)' : imported.summary.title} —{' '}
              {imported.summary.scenes} scene{imported.summary.scenes === 1 ? '' : 's'},{' '}
              {imported.summary.entities} entities ·{' '}
              {imported.lint.errors.length === 0
                ? 'no errors'
                : `${imported.lint.errors.length} error${imported.lint.errors.length === 1 ? '' : 's'} to fix before it can publish`}
              {imported.summary.extra_blocks.length === 0
                ? ''
                : ` · keeps ${imported.summary.extra_blocks.join(', ')}`}
            </p>
          ) : (
            <p className="admin-error">{imported.message}</p>
          )}
        </>
      ) : null}

      <div className="field">
        <label>
          <span className="label-text">Title</span>
          <input
            type="text"
            value={title}
            placeholder={
              mode === 'duplicate'
                ? `${source?.title ?? ''} (copy)`
                : mode === 'import'
                  ? (importedPkg?.summary.title ?? 'from the package')
                  : 'The Dragon of…'
            }
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
          {mode === 'new'
            ? 'Create the draft'
            : mode === 'import'
              ? 'Import into a new draft'
              : 'Duplicate into a new draft'}
        </button>
      </div>

      {error === null ? null : <p className="admin-error">{error}</p>}
    </main>
  );
}
