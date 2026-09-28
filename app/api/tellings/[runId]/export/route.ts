import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { exportFileName, renderEditionHtml } from '@/edition/export';

export const dynamic = 'force-dynamic';

/**
 * A finished telling as a standalone HTML document, to read or share without the app.
 *
 * `?download=1` hands it over as a file; without it the document opens in the tab, where its
 * print stylesheet makes the browser's "Save as PDF" produce a clean book-like PDF. Open to
 * anyone who has the run id, exactly like `GET /api/tellings/{runId}?include=scenes` — it carries
 * the same prose and nothing of the Story Package behind it (ADR 0015 §5).
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const repository = storyRepository();

  const manifest = await repository.getEditionManifest(runId);
  if (manifest === null) {
    return NextResponse.json({ error: `No telling with run id "${runId}"` }, { status: 404 });
  }
  if (manifest.status !== 'complete') {
    return NextResponse.json(
      { error: 'the telling is not finished; there is nothing to export yet' },
      { status: 409 },
    );
  }

  // The title of the package version this telling was compiled from — the one it tells — not
  // whatever the story is called today.
  const pkg =
    (await repository.getPackageVersion(manifest.story_id, manifest.package_version)) ??
    (await repository.getCurrentPackage(manifest.story_id));
  const entry = (await repository.getRunIndex(manifest.story_id)).runs.find(
    (run) => run.run_id === runId,
  );

  const edition = {
    title: pkg?.metadata.title ?? manifest.story_id,
    run_id: runId,
    name: entry?.saved === true ? entry.name : null,
    completed_at: manifest.completed_at,
    scenes: await repository.getEditionScenes(runId),
  };

  const download = new URL(request.url).searchParams.get('download') === '1';
  const filename = exportFileName(edition);
  return new Response(renderEditionHtml(edition), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    },
  });
}
