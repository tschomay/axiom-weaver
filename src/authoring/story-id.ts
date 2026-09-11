/**
 * What a `story_id` may be.
 *
 * Its own module, with no dependency on anything that reaches a filesystem, because both the
 * server that enforces these rules and the browser that previews them need them. `manuscript.ts`
 * pulls in the linter, and the linter pulls in the fixture loader and `node:fs` with it — so
 * importing the slug rule from there would put the filesystem in a client bundle.
 */

/** The shape a `story_id` must have: a blob path segment, lowercase, no surprises. */
export const STORY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Ids the router owns.
 *
 * `/stories/new` is a screen, and a static segment wins over `[storyId]` — so a story that
 * managed to claim `new` would be one no URL could reach. Refused at the point the id is claimed
 * rather than discovered later, when the id is fixed.
 */
export const RESERVED_STORY_IDS: ReadonlySet<string> = new Set(['new']);

/** A `story_id` slugged from a title: the shape every fixture id already has. */
export function slugifyStoryId(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
