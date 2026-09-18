'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { slugifyStoryId } from '@/authoring/story-id';
import { AuthorTokenField, useAuthorSession } from '../../author-token';
import { parseImport, type ImportResult, type ImportSummary } from '@/authoring/transfer';
import type { LintResult } from '@/authoring/lint';
import type { DraftStoryPackage } from '@/schema/manuscript';
import { FileOpenButton } from '../[storyId]/edit/controls';
import { useStoryIdCheck } from '../[storyId]/edit/use-story-id-check';
import {
  EVENT_COUNT_BAND,
  PLANT_DENSITIES,
  PLOT_SHAPE_IDS,
  materializePlotShape,
  type PlantPolicy,
  type PremiseModules,
} from '@/arc/brief';

/** The Generate tab's 8 optional structured-premise fields (ADR 0021, #172). */
const MODULE_FIELDS: ReadonlyArray<{ key: keyof PremiseModules; label: string; placeholder: string }> = [
  { key: 'theme', label: 'Theme', placeholder: 'what the story is really about' },
  { key: 'setting_time', label: 'When', placeholder: 'a drought summer, a failing order book…' },
  { key: 'setting_place', label: 'Where', placeholder: 'a river crossing town, a glaze works…' },
  { key: 'protagonist', label: 'Protagonist', placeholder: 'who this follows' },
  { key: 'protagonist_want', label: 'What they want', placeholder: '' },
  { key: 'antagonism', label: 'What opposes it', placeholder: '' },
  { key: 'complication', label: 'The complication', placeholder: '' },
  { key: 'ending_shape', label: 'Ending shape', placeholder: 'how it resolves, and at what cost' },
];

type GenerateStatus = 'idle' | 'running' | 'complete' | 'failed';

/** `GET /api/authoring/generate/{runId}`'s shape — see that route for what each field means. */
interface AuthoringPollResponse {
  readonly status: 'running' | 'complete' | 'failed';
  readonly progress: { readonly text: string | null };
  readonly failure: { readonly detail: string } | null;
  readonly result: { readonly events: number; readonly events_per_scene: number } | null;
  readonly package?: DraftStoryPackage;
  readonly lint?: LintResult;
  readonly summary?: ImportSummary;
}

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

  const [mode, setMode] = useState<'new' | 'duplicate' | 'import' | 'generate'>('new');
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

  // --- Generate (ADR 0021, #172) --------------------------------------------------------------

  const [logline, setLogline] = useState('');
  const [useModules, setUseModules] = useState(false);
  const [modules, setModules] = useState<Partial<Record<keyof PremiseModules, string>>>({});
  const [plotShapePreset, setPlotShapePreset] = useState(PLOT_SHAPE_IDS[0] ?? 'mystery');
  const [eventCount, setEventCount] = useState<number>(EVENT_COUNT_BAND.default);
  const [plantDensity, setPlantDensity] = useState<PlantPolicy['density']>('normal');
  const [spanGuidance, setSpanGuidance] = useState(true);

  const [genRunId, setGenRunId] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<GenerateStatus>('idle');
  const [genProgress, setGenProgress] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genQuality, setGenQuality] = useState<{ events: number; eventsPerScene: number } | null>(
    null,
  );

  // Poll the run while it is going. Self-terminating: once a response says anything but
  // `running`, `genStatus` moves off `running` and this effect's guard stops scheduling the next
  // poll, the same reconnect-safe-polling shape `GET /api/tellings/[runId]` established.
  useEffect(() => {
    if (genRunId === null || genStatus !== 'running') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = (): void => {
      void fetch(`/api/authoring/generate/${genRunId}`)
        .then((response) => response.json() as Promise<AuthoringPollResponse>)
        .then((body) => {
          if (cancelled) return;
          setGenProgress(body.progress.text ?? '');

          if (body.status === 'running') {
            timer = setTimeout(poll, 2500);
            return;
          }
          if (body.status === 'failed') {
            setGenStatus('failed');
            setGenError(body.failure?.detail ?? 'the run failed');
            return;
          }
          // complete — the same {package, lint, summary} shape a pasted/uploaded import produces.
          setGenStatus('complete');
          setGenQuality(
            body.result === null
              ? null
              : { events: body.result.events, eventsPerScene: body.result.events_per_scene },
          );
          if (body.package !== undefined && body.lint !== undefined && body.summary !== undefined) {
            setImported({ ok: true, package: body.package, lint: body.lint, summary: body.summary });
          }
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setGenStatus('failed');
          setGenError(reason instanceof Error ? reason.message : 'lost contact with the run');
        });
    };
    poll();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [genRunId, genStatus]);

  const startGenerate = (): void => {
    setGenBusy(true);
    setGenError(null);
    setGenQuality(null);
    setImported(null);
    const premise = {
      logline: logline.trim(),
      modules: useModules
        ? {
            theme: modules.theme ?? '',
            setting_time: modules.setting_time ?? '',
            setting_place: modules.setting_place ?? '',
            protagonist: modules.protagonist ?? '',
            protagonist_want: modules.protagonist_want ?? '',
            antagonism: modules.antagonism ?? '',
            complication: modules.complication ?? '',
            ending_shape: modules.ending_shape ?? '',
          }
        : null,
    };

    void fetch('/api/authoring/generate', {
      method: 'POST',
      headers: session.headers(),
      body: JSON.stringify({
        title: title.trim(),
        premise,
        plot_shape_preset: plotShapePreset,
        event_count: eventCount,
        plant_density: plantDensity,
        span_guidance: spanGuidance,
      }),
    })
      .then(async (response) => {
        const body = (await response.json()) as { run_id?: string; error?: string };
        if (!response.ok || body.run_id === undefined) {
          setGenError(body.error ?? `could not start generation (${response.status})`);
          return;
        }
        setGenRunId(body.run_id);
        setGenStatus('running');
        setGenProgress('starting…');
      })
      .catch((reason: unknown) =>
        setGenError(reason instanceof Error ? reason.message : 'could not start generation'),
      )
      .finally(() => setGenBusy(false));
  };

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
      : mode === 'duplicate'
        ? source !== undefined && version !== null
        : importedPkg !== null && effectiveTitle.trim() !== '');

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

    if (mode === 'import' || mode === 'generate') {
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
        <button
          type="button"
          className={mode === 'generate' ? 'action primary' : 'action'}
          onClick={() => setMode('generate')}
        >
          Generate from a premise
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
        </>
      ) : null}

      {mode === 'generate' ? (
        <>
          <p className="lede">
            A premise in, a Fabula arc drafted and segmented into Scene Cards out — the same two
            steps <code>npm run generate-arc</code> then <code>npm run segment</code> run from a
            terminal, started here instead. It takes a couple of minutes and calls the model
            several times; nothing is imported until you review the result below and choose to.
          </p>

          <div className="field">
            <label>
              <span className="label-text">Logline</span>
              <textarea
                value={logline}
                placeholder="A river ferry sinks in calm water, and the woman who signed off on its last inspection has to find out why before the inquiry does."
                onChange={(event) => setLogline(event.target.value)}
              />
            </label>
          </div>

          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={useModules}
                onChange={(event) => setUseModules(event.target.checked)}
              />{' '}
              <span className="label-text">Add structured details</span>
            </label>
            <span className="hint">
              Optional — a typed premise (theme, setting, cast roles…) spreads the output more
              than a logline alone. Left off, only the logline goes to the model.
            </span>
          </div>

          {useModules ? (
            <>
              {MODULE_FIELDS.map((field) => (
                <div className="field" key={field.key}>
                  <label>
                    <span className="label-text">{field.label}</span>
                    <input
                      type="text"
                      value={modules[field.key] ?? ''}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setModules((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    />
                  </label>
                </div>
              ))}
            </>
          ) : null}

          <div className="field">
            <label>
              <span className="label-text">Plot shape</span>
              <select
                value={plotShapePreset}
                onChange={(event) => setPlotShapePreset(event.target.value)}
              >
                {PLOT_SHAPE_IDS.map((id) => {
                  const shape = materializePlotShape(id);
                  return (
                    <option key={id} value={id}>
                      {shape.name} — {shape.central_question}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <div className="field">
            <label>
              <span className="label-text">Event count</span>
              <input
                type="number"
                min={EVENT_COUNT_BAND.min}
                max={EVENT_COUNT_BAND.max}
                value={eventCount}
                onChange={(event) => setEventCount(Number(event.target.value))}
              />
            </label>
            <span className="hint">
              {EVENT_COUNT_BAND.min}–{EVENT_COUNT_BAND.max} Fabula events; roughly{' '}
              {Math.round(eventCount / 1.4)} Scene Cards once segmented.
            </span>
          </div>

          <div className="field">
            <label>
              <span className="label-text">Plant/payoff density</span>
              <select
                value={plantDensity}
                onChange={(event) => setPlantDensity(event.target.value as PlantPolicy['density'])}
              >
                {PLANT_DENSITIES.map((density) => (
                  <option key={density} value={density}>
                    {density}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={spanGuidance}
                onChange={(event) => setSpanGuidance(event.target.checked)}
              />{' '}
              <span className="label-text">Ask for long-range plants</span>
            </label>
            <span className="hint">
              On by default. Off measures whether the model reaches across the arc without being
              told to.
            </span>
          </div>

          <div className="row-actions">
            <button
              type="button"
              className="action primary"
              disabled={
                !session.canWrite ||
                genBusy ||
                genStatus === 'running' ||
                logline.trim() === '' ||
                title.trim() === ''
              }
              onClick={startGenerate}
            >
              {genStatus === 'running' ? 'Generating…' : 'Generate the arc'}
            </button>
          </div>
          {title.trim() === '' && genStatus !== 'running' ? (
            <span className="hint">Set a title below first — it names the drafted arc.</span>
          ) : null}

          {genStatus === 'running' ? <p className="meta">{genProgress || 'working…'}</p> : null}
          {genStatus === 'failed' ? (
            <p className="admin-error">{genError ?? 'the run failed'}</p>
          ) : null}
          {genStatus === 'complete' && genQuality !== null ? (
            <p className="meta">
              {genQuality.events} Fabula events →{' '}
              {importedPkg !== null ? importedPkg.summary.scenes : '?'} scenes (
              {genQuality.eventsPerScene.toFixed(1)} events/scene) — segmentation
              over-segments past Cinderella-scale, so judge a choppy result on its own terms.
            </p>
          ) : null}
        </>
      ) : null}

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

      <div className="field">
        <label>
          <span className="label-text">Title</span>
          <input
            type="text"
            value={title}
            placeholder={
              mode === 'duplicate'
                ? `${source?.title ?? ''} (copy)`
                : mode === 'import' || mode === 'generate'
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
            : mode === 'duplicate'
              ? 'Duplicate into a new draft'
              : 'Import into a new draft'}
        </button>
      </div>

      {error === null ? null : <p className="admin-error">{error}</p>}
    </main>
  );
}
