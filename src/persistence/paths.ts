/**
 * Blob pathnames.
 *
 * The layout is `docs/research/vercel-runtime.md` §3.5 as amended by ADR 0015 §2/§4 (retained
 * `package_version` snapshots, the Working Draft's per-story prefix) and ADR 0016 §2 (the
 * state-update commit log). Every path in the system is built here so the layout is one file to
 * read and one file to change.
 *
 * ```
 * story/{storyId}/package.json              pointer to the current package_version
 * story/{storyId}/package/{version}.json    retained, immutable package_version snapshot
 * story/{storyId}/draft/manifest.json       Working Draft: per-scene compiled_against + stale
 * story/{storyId}/draft/scene-{n}.json      Working Draft: prose + Scene Digest per scene
 * story/{storyId}/draft/state-log.json      Working Draft: state-update commit log
 * story/{storyId}/runs.json                 the story's own list of run ids (see below)
 * edition/{runId}/manifest.json             Compiled edition: status, pinned version, index
 * edition/{runId}/scene-{n}.json            Compiled edition: prose + Scene Digest per scene
 * edition/{runId}/world-model.json          World Model at close of run
 * edition/{runId}/discourse.json            Discourse Record + told-ledger at close of run
 * edition/{runId}/state-log.json            Compiled edition: state-update commit log
 * edition/{runId}/run-report.json           Compiled edition: the run report (ADR 0014 §8)
 * baked/{storyId}.json                      pointer to the Baked edition's runId
 * ```
 *
 * `story/{storyId}/runs.json` is the one path here the settled layout does not name. Editions are
 * addressed by run id alone, which is right for sharing but leaves "which runs belong to this
 * story" unanswerable without listing every edition in the store — and ADR 0014 §8 requires that
 * question, since the run report aggregates across runs grouped by Scene Card id. It is an index,
 * not content: an edition stands on its own without it.
 */

export const storyPrefix = (storyId: string): string => `story/${storyId}/`;

/** The convenience pointer to the current version — not the sole record (ADR 0015 §2). */
export const packagePointerPath = (storyId: string): string => `story/${storyId}/package.json`;

/** A retained, immutable snapshot of one `package_version`. */
export const packageVersionPath = (storyId: string, version: number): string =>
  `story/${storyId}/package/${version}.json`;

export const packageVersionPrefix = (storyId: string): string => `story/${storyId}/package/`;

export const draftManifestPath = (storyId: string): string =>
  `story/${storyId}/draft/manifest.json`;

export const draftScenePath = (storyId: string, sceneIndex: number): string =>
  `story/${storyId}/draft/scene-${sceneIndex}.json`;

export const draftStateLogPath = (storyId: string): string =>
  `story/${storyId}/draft/state-log.json`;

export const editionManifestPath = (runId: string): string => `edition/${runId}/manifest.json`;

export const editionScenePath = (runId: string, sceneIndex: number): string =>
  `edition/${runId}/scene-${sceneIndex}.json`;

export const editionWorldModelPath = (runId: string): string =>
  `edition/${runId}/world-model.json`;

export const editionDiscoursePath = (runId: string): string => `edition/${runId}/discourse.json`;

export const editionStateLogPath = (runId: string): string => `edition/${runId}/state-log.json`;

/** The run report, stored as a Blob document alongside the edition (ADR 0014 §8). */
export const runReportPath = (runId: string): string => `edition/${runId}/run-report.json`;

/** The per-story index of run ids — a lookup, never a second copy of an edition. */
export const runIndexPath = (storyId: string): string => `story/${storyId}/runs.json`;

export const bakedPointerPath = (storyId: string): string => `baked/${storyId}.json`;

/** Parse a `package_version` out of a snapshot pathname; `null` if the name is not one. */
export function versionFromPackagePath(pathname: string): number | null {
  const match = /\/package\/(\d+)\.json$/.exec(pathname);
  if (match === null || match[1] === undefined) return null;
  return Number.parseInt(match[1], 10);
}
