/**
 * Where the source prose comes from, and how a run pins the exact bytes it read.
 *
 * The two ground-truth fixtures are packages, not prose: `fixtures/cinderella/package.json` and
 * `fixtures/a-christmas-carol/package.json` carry no source text, and neither does the repo.
 * `docs/research/fixture-stories.md` names the edition, the Project Gutenberg ebook number, the
 * GITenberg mirror it was actually read from, and the line range the story occupies inside that
 * file — that is the whole provenance chain, so this module encodes it rather than restating it.
 *
 * The text itself is *not* committed. It is fetched on demand into a gitignored cache under
 * `.data/sources/`, sliced to the recorded line range, and hashed. The hash goes into every
 * extraction result: a fidelity score against prose nobody can identify is not a measurement, and
 * the mirror could change under us without the URL doing so.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PASTED_SOURCE_MAX_WORDS, PASTED_SOURCE_MIN_WORDS, countWords } from './limits';

export interface SourceManifest {
  /** Matches the fixture directory name, so `cinderella` scores against `fixtures/cinderella`. */
  readonly id: string;
  readonly title: string;
  readonly edition: string;
  /**
   * Where the plain text is actually read from.
   *
   * The first two are raw GITenberg mirrors of the Project Gutenberg text. GITenberg's corpus
   * stops well short of recent PG additions, so `the-machine-stops` reads Project Gutenberg's own
   * cache URL instead — the same bytes, one hop earlier, and the sha256 below is what actually
   * pins them either way.
   */
  readonly url: string;
  readonly cache_file: string;
  /** 1-based, inclusive, into the mirrored plain text — the idiom `fixture-stories.md` uses. */
  readonly first_line: number;
  readonly last_line: number;
  /** The word count `fixture-stories.md` recorded, as a cheap sanity check on the slice. */
  readonly expected_words: number;
}

export const SOURCE_MANIFESTS: readonly SourceManifest[] = [
  {
    id: 'cinderella',
    title: 'Cinderella, or the Little Glass Slipper',
    edition: "Andrew Lang (ed.), The Blue Fairy Book, Longmans, Green & Co., 1889 (PG #503)",
    url: 'https://raw.githubusercontent.com/GITenberg/The-Blue-Fairy-Book_503/master/503.txt',
    cache_file: '503.txt',
    first_line: 2516,
    last_line: 2790,
    expected_words: 2461,
  },
  {
    id: 'a-christmas-carol',
    title: 'A Christmas Carol, in Prose: Being a Ghost Story of Christmas',
    edition: 'Charles Dickens, 1843 (PG #46)',
    url: 'https://raw.githubusercontent.com/GITenberg/A-Christmas-Carol_46/master/46.txt',
    cache_file: '46.txt',
    first_line: 64,
    last_line: 3870,
    expected_words: 28448,
  },
  {
    // #132's hard fixture, wired up for scoring in wave 2 of #142. It existed as a package from
    // phase 2 of #132 but had no manifest, so its source could not be fetched and every §3
    // metric was silently a two-fixture measurement over two short realist Victorian stories —
    // exactly the "easy end of the range" `story-authoring-eval.md` §2 warns its own numbers
    // describe. It is the held-out fixture now: prompts are tuned against the other two and
    // reported here separately.
    id: 'the-machine-stops',
    title: 'The Machine Stops',
    edition:
      'E. M. Forster, The Eternal Moment and Other Stories, Harcourt, Brace & Co., 1928 ' +
      '(PG #72890; first published in The Oxford and Cambridge Review, November 1909)',
    url: 'https://www.gutenberg.org/cache/epub/72890/pg72890.txt',
    cache_file: '72890.txt',
    // The story occupies lines 101–1534 of the collection: its title line through "scraps of the
    // untainted sky.", stopping before THE POINT OF IT. Parts I–III (The Air-Ship / The Mending
    // Apparatus / The Homeless) are all inside that range. Line numbers are into the cache/epub
    // rendering this `url` names — PG's `files/` rendering of the same ebook carries different
    // front matter and numbers ~26 lines lower, so the two are not interchangeable.
    first_line: 101,
    last_line: 1534,
    // Measured on the slice. `docs/research/fixture-stories.md` records wikisource's own
    // description as "a science fiction short story (of 12,000 words)", which this corroborates.
    expected_words: 12162,
  },
];

export function manifestFor(id: string): SourceManifest {
  const manifest = SOURCE_MANIFESTS.find((entry) => entry.id === id);
  if (manifest === undefined) {
    const known = SOURCE_MANIFESTS.map((entry) => entry.id).join(', ');
    throw new Error(`No source manifest for "${id}". Known sources: ${known}`);
  }
  return manifest;
}

export interface LoadedSource {
  readonly manifest: SourceManifest;
  /** The story body only — the enclosing volume's other tales and the PG boilerplate are cut. */
  readonly text: string;
  readonly words: number;
  readonly sha256: string;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Cut the story body out of a whole-volume plain text.
 *
 * Line-range slicing rather than heading-matching on purpose: the ranges in
 * `fixture-stories.md` were verified by a human against these exact mirrored files, and a regex
 * over "CINDERELLA" would also match the table of contents.
 */
export function sliceLines(whole: string, firstLine: number, lastLine: number): string {
  // CRLF is normalized away here, once, before anything indexes into the text. Project Gutenberg
  // plain text ships with CRLF endings, and leaving them in is not cosmetic: paragraph detection
  // splits on a blank line, and `\r\n\r\n` is not a blank line to a `\n\s*\n` matcher. Left
  // unnormalized, both fixtures parse as a *single* paragraph, every window collapses to one, and
  // the pipeline quietly becomes the single whole-novel call that `narrative-extraction-prior-art.md`
  // §5 exists to argue against — while still reporting a window count and looking fine.
  const lines = whole.replace(/\r\n?/g, '\n').split('\n');
  return lines.slice(firstLine - 1, lastLine).join('\n').trim();
}

export async function loadSource(
  id: string,
  options: { cacheDir?: string; fetchImpl?: typeof fetch } = {},
): Promise<LoadedSource> {
  const manifest = manifestFor(id);
  const cacheDir = options.cacheDir ?? path.join(process.cwd(), '.data', 'sources');
  const cached = path.join(cacheDir, manifest.cache_file);

  let whole: string;
  try {
    whole = await readFile(cached, 'utf8');
  } catch {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(manifest.url);
    if (!response.ok) {
      throw new Error(`Fetching ${manifest.url} returned ${response.status}`);
    }
    whole = await response.text();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cached, whole, 'utf8');
  }

  const text = sliceLines(whole, manifest.first_line, manifest.last_line);
  return { manifest, text, words: countWords(text), sha256: sha256(text) };
}

// Re-exported so existing callers keep importing them from here; defined in `limits.ts` so a
// client component can read them too.
export { PASTED_SOURCE_MAX_WORDS, PASTED_SOURCE_MIN_WORDS, countWords };

export interface PastedSourceInput {
  /** Becomes the extracted package's `story_id`; the Import step still lets the author change it. */
  readonly id: string;
  readonly title: string;
  readonly author?: string | null;
  readonly text: string;
}

/**
 * A `LoadedSource` built from raw text rather than a manifest lookup (#173).
 *
 * `loadSource` exists to pin a *known* public-domain edition to exact bytes: a URL, a cache file,
 * a verified line range. Pasted prose has none of that — its provenance is the author — so this
 * fills the manifest with what is actually known: the whole text is the story (lines 1–n), the
 * expected word count is the measured one, and there is no URL. The sha256 still goes into the
 * package, so a result can be matched back to the exact text it read.
 */
export function pastedSource(input: PastedSourceInput): LoadedSource {
  // The same CRLF normalization `sliceLines` does, for the same reason: paragraph detection
  // splits on blank lines, and pasted text from a Windows clipboard arrives with `\r\n`.
  const text = input.text.replace(/\r\n?/g, '\n').trim();
  const author = input.author?.trim() ?? '';
  const words = countWords(text);
  const manifest: SourceManifest = {
    id: input.id,
    title: input.title.trim(),
    edition: author === '' ? 'pasted text' : `${author} (pasted text)`,
    url: '',
    cache_file: '',
    first_line: 1,
    last_line: text === '' ? 0 : text.split('\n').length,
    expected_words: words,
  };
  return { manifest, text, words, sha256: sha256(text) };
}
