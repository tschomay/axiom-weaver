/**
 * The bounds on what the Extract entry point will read (#173), kept apart from `sources.ts` so
 * the new-story screen can show the same numbers the route enforces — `sources.ts` reads the
 * filesystem and cannot be bundled into a client component.
 */

/**
 * The word bound on a source read through the UI. Extraction is the priciest pipeline stage
 * measured so far, its call count grows with the number of reading windows, and a pasted story's
 * length is otherwise unbounded on a shared key. Set just above *A Christmas Carol* (28,448
 * words), the longest source with a known-good run in `fixtures/extraction/runs/`, so all three
 * fixtures can still round-trip through the UI — nothing longer has ever been measured.
 */
export const PASTED_SOURCE_MAX_WORDS = 30_000;

/** Below this there is no story to segment, and the run would spend calls on a fragment. */
export const PASTED_SOURCE_MIN_WORDS = 100;

export function countWords(text: string): number {
  const matched = text.match(/\S+/g);
  return matched === null ? 0 : matched.length;
}
