/**
 * A finished telling as one self-contained HTML document — something to read or pass along
 * without the app.
 *
 * The same file serves both ways out: downloaded, it opens in any browser offline (no scripts or
 * stylesheets fetched from anywhere); opened in a tab, its print stylesheet is laid out for the
 * browser's "Save as PDF", which typesets real text far better than anything this server could
 * draw into a PDF by hand, and adds no dependency to do it.
 *
 * What it carries is what sharing an edition's URL already exposes (ADR 0015 §5): the story's
 * title and the edition's prose. Never the Story Package behind it — no Scene Card ids, no World
 * Model, no Voice Card — so scenes are separated by a plain break rather than labelled.
 */

import type { EditionScene } from './edition';

export interface EditionExport {
  readonly title: string;
  readonly run_id: string;
  /** The author's library name for this telling, when it has one. */
  readonly name: string | null;
  readonly completed_at: string | null;
  readonly scenes: ReadonlyArray<Pick<EditionScene, 'scene_index' | 'prose'>>;
}

export function renderEditionHtml(edition: EditionExport): string {
  const scenes = [...edition.scenes].sort((a, b) => a.scene_index - b.scene_index);
  const body = scenes
    .map((scene) => `<section class="scene">\n${paragraphs(scene.prose)}\n</section>`)
    .join('\n<p class="break" aria-hidden="true">⁂</p>\n');

  const when = formatDate(edition.completed_at);
  const colophon = [
    `Telling <code>${escapeHtml(edition.run_id)}</code>`,
    when === null ? null : `compiled ${escapeHtml(when)}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Axiom Weaver">
<title>${escapeHtml(edition.name ?? edition.title)}</title>
<style>
  :root { color-scheme: light dark; --ink: #1d1b18; --paper: #fbf9f4; --muted: #6b655c; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e8e4dc; --paper: #1a1917; --muted: #9a9387; } }
  html { background: var(--paper); color: var(--ink); }
  body { margin: 0 auto; max-width: 36rem; padding: 3rem 1.25rem 5rem;
    font: 1.125rem/1.7 Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, serif; }
  header { text-align: center; margin-bottom: 3rem; }
  h1 { font-size: 2rem; line-height: 1.2; font-weight: normal; margin: 0 0 0.5rem; }
  .subtitle { font-style: italic; margin: 0; }
  .colophon { color: var(--muted); font-size: 0.8rem; margin-top: 1rem; }
  .colophon code { font-size: 0.75rem; }
  .scene p { margin: 0; text-indent: 1.5em; }
  .scene p:first-child { text-indent: 0; }
  .break { text-align: center; color: var(--muted); margin: 2rem 0; }
  .toolbar { position: fixed; top: 0.75rem; right: 0.75rem; }
  .toolbar button { font: 0.85rem system-ui, sans-serif; padding: 0.4rem 0.8rem; cursor: pointer; }
  @page { margin: 2.2cm 2cm; }
  @media print {
    :root { --ink: #000; --paper: #fff; --muted: #555; }
    .toolbar { display: none; }
    body { max-width: none; padding: 0; font-size: 11.5pt; }
    header { margin: 6cm 0 0; break-after: page; }
    .scene p { orphans: 2; widows: 2; }
    .break { break-after: avoid; }
  }
</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">Save as PDF / print</button></div>
<header>
<h1>${escapeHtml(edition.title)}</h1>
${edition.name === null ? '' : `<p class="subtitle">${escapeHtml(edition.name)}</p>\n`}<p class="colophon">${colophon}</p>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

/**
 * A file name a reader would recognise in their downloads folder: the story title (or the
 * library name), slugged, and the run id so two tellings of one story never collide.
 */
export function exportFileName(edition: Pick<EditionExport, 'title' | 'name' | 'run_id'>): string {
  const slug = (edition.name ?? edition.title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const run = edition.run_id.replace(/[^A-Za-z0-9_-]+/g, '-');
  // A run id already leads with its story id, which is usually the title's slug too.
  if (slug !== '' && run.startsWith(`${slug}-`)) return `${run}.html`;
  return `${slug === '' ? 'telling' : slug}-${run}.html`;
}

/** The writer's prose, split on blank lines into paragraphs; single newlines become line breaks. */
function paragraphs(prose: string): string {
  return prose
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString().slice(0, 10);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
