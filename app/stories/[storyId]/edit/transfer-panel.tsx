'use client';

import { useState } from 'react';
import type { DraftStoryPackage } from '@/schema/manuscript';
import {
  adoptStoryId,
  exportFilename,
  parseImport,
  serializePackage,
  type ImportResult,
} from '@/authoring/transfer';
import { FileOpenButton } from './controls';

/**
 * The escape hatch (ADR 0017 §6).
 *
 * The reason the forms either side of it are allowed to stay narrow: whatever an editor cannot
 * yet express, the JSON can, and the whole package is always one button from being a file. It
 * round-trips the existing fixtures, which is what makes that claim checkable rather than hopeful.
 *
 * Import lands in the **Manuscript** and nowhere else. A second path to a retained version would
 * be a path around the publish gate, which is the one thing publishing is for.
 */
export function TransferPanel({
  storyId,
  pkg,
  retainedVersions,
  onImport,
}: {
  storyId: string;
  pkg: DraftStoryPackage;
  retainedVersions: readonly number[];
  onImport: (next: DraftStoryPackage) => void;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const download = (body: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const read = (next: string) => {
    setText(next);
    setResult(next.trim() === '' ? null : parseImport(next));
  };

  return (
    <section>
      <h2>Export</h2>
      <p className="lede">
        The same JSON the fixtures are written in — two spaces, one trailing newline — so an
        exported package diffs against one of them, and a retained version exports byte-for-byte
        as the store holds it.
      </p>

      <div className="row-actions">
        <button
          type="button"
          className="action"
          onClick={() => download(serializePackage(pkg), exportFilename(storyId, null))}
        >
          Download this draft
        </button>
        <button
          type="button"
          className="action"
          onClick={() => {
            void navigator.clipboard
              .writeText(serializePackage(pkg))
              .then(() => setCopied('draft'))
              .catch(() => setCopied(null));
          }}
        >
          Copy this draft
        </button>
        {copied === null ? null : <span className="meta">copied</span>}
      </div>

      {retainedVersions.length === 0 ? (
        <p className="meta">Nothing published yet, so there is no retained version to export.</p>
      ) : (
        <div className="row-actions">
          {retainedVersions.map((version) => (
            <button
              key={version}
              type="button"
              className="tiny"
              onClick={() => {
                void fetch(`/api/stories/${storyId}/package/${version}`)
                  .then((response) => response.json() as Promise<unknown>)
                  .then((body) =>
                    download(serializePackage(body), exportFilename(storyId, version)),
                  )
                  .catch(() => undefined);
              }}
            >
              download v{version}
            </button>
          ))}
        </div>
      )}

      <h2>Import</h2>
      <p className="lede">
        Paste or open a package. It is checked before anything is saved, and it replaces this
        draft — not the published version, which only a publish can change.
      </p>

      <div className="row-actions">
        <FileOpenButton onText={read} />
      </div>

      <div className="field">
        <label>
          <span className="label-text">or paste it here</span>
          <textarea
            className="import-box"
            value={text}
            spellCheck={false}
            placeholder='{ "schema_version": "1.0", … }'
            onChange={(event) => read(event.target.value)}
          />
        </label>
      </div>

      {result === null ? null : result.ok ? (
        <div className="panel">
          <h3>
            {result.summary.title === '' ? '(untitled)' : result.summary.title} —{' '}
            {result.summary.scenes} scene{result.summary.scenes === 1 ? '' : 's'},{' '}
            {result.summary.entities} entities
          </h3>
          <p className="meta">
            names itself <code>{result.summary.story_id}</code>
            {result.summary.story_id === storyId
              ? ''
              : ` — it will be imported as ${storyId}, because that is the story you are in`}
            {result.summary.extra_blocks.length === 0
              ? ''
              : ` · carries ${result.summary.extra_blocks.join(', ')}, which will be kept`}
          </p>

          {result.lint.problems.length === 0 ? (
            <p className="meta">The linter has nothing to say about it.</p>
          ) : (
            <>
              <p className="meta">
                {result.lint.errors.length} error
                {result.lint.errors.length === 1 ? '' : 's'} and {result.lint.warnings.length}{' '}
                warning{result.lint.warnings.length === 1 ? '' : 's'}. A package with problems still
                imports — the editor is where you fix them, and publishing is what the errors
                block.
              </p>
              {[...result.lint.errors, ...result.lint.warnings].slice(0, 8).map((problem, index) => (
                // Keyed by position: two rows can report the same path.
                <div
                  key={index}
                  className={problem.severity === 'error' ? 'diagnostic error' : 'diagnostic'}
                >
                  <span className="head">{problem.path}</span> {problem.message}
                </div>
              ))}
              {result.lint.problems.length > 8 ? (
                <p className="meta">…and {result.lint.problems.length - 8} more.</p>
              ) : null}
            </>
          )}

          <div className="row-actions">
            <button
              type="button"
              className="action primary"
              onClick={() => {
                onImport(adoptStoryId(result.package, storyId));
                setText('');
                setResult(null);
              }}
            >
              Replace this draft
            </button>
            <button
              type="button"
              className="action"
              onClick={() => {
                setText('');
                setResult(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="admin-error">{result.message}</p>
      )}
    </section>
  );
}
