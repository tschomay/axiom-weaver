import Link from 'next/link';
import { storyRepository } from '@/persistence';
import { WorldModel } from '@/world-model/world-model';

export const dynamic = 'force-dynamic';

interface StorySummary {
  storyId: string;
  title: string;
  packageVersion: number;
  retainedVersions: number[];
  scenes: number;
  entities: number;
}

async function summaries(): Promise<StorySummary[]> {
  const repository = storyRepository();
  const storyIds = await repository.listStoryIds();

  const rows: StorySummary[] = [];
  for (const storyId of storyIds) {
    const pkg = await repository.getCurrentPackage(storyId);
    if (pkg === null) continue;
    const model = WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed);
    rows.push({
      storyId,
      title: pkg.metadata.title,
      packageVersion: pkg.package_version,
      retainedVersions: await repository.listPackageVersions(storyId),
      scenes: pkg.scene_cards.length,
      entities:
        model.rows('character').length +
        model.rows('location').length +
        model.rows('object').length,
    });
  }
  return rows;
}

export default async function Home() {
  const stories = await summaries();

  return (
    <main>
      <h1>Axiom Weaver</h1>
      <p className="lede">
        A story is authored once as a structured Story Package and performed into prose on every
        read. Pick a story to open its author surfaces: the Working Draft and its scene compile
        view, the World &amp; Discourse inspector, and the run report.
      </p>

      <h2>Stories</h2>
      {stories.length === 0 ? (
        <p className="meta">
          Nothing loaded. Run <code>npm run load-fixtures</code> from a terminal, or use{' '}
          <Link href="/admin/load-fixtures">/admin/load-fixtures</Link> from a browser.
        </p>
      ) : (
        stories.map((story) => (
          <div className="story" key={story.storyId}>
            <h3>
              <Link href={`/stories/${story.storyId}`}>{story.title}</Link>
            </h3>
            <p className="meta">
              {story.storyId} · package_version {story.packageVersion} (retained:{' '}
              {story.retainedVersions.join(', ')}) · {story.scenes} scene cards · {story.entities}{' '}
              entities
            </p>
            <p className="meta">
              <Link href={`/stories/${story.storyId}`}>Working Draft</Link> ·{' '}
              <Link href={`/stories/${story.storyId}/inspector`}>World &amp; Discourse</Link> ·{' '}
              <Link href={`/stories/${story.storyId}/runs`}>Run report</Link>
            </p>
          </div>
        ))
      )}

      <h2>Read surfaces</h2>
      <ul className="paths">
        <li>
          <code>GET /api/stories</code> — every story with a retained package
        </li>
        <li>
          <code>GET /api/stories/{'{storyId}'}/package</code> — the current Story Package
        </li>
        <li>
          <code>GET /api/stories/{'{storyId}'}/package/{'{version}'}</code> — a retained snapshot
        </li>
        <li>
          <code>GET /api/stories/{'{storyId}'}/world-model?scene=N</code> — the World Model as of
          scene N, replayed from the commit log
        </li>
        <li>
          <code>GET /api/stories/{'{storyId}'}/proposals</code> — the proposals queue: volitional
          proposals awaiting the author
        </li>
        <li>
          <code>GET /api/stories/{'{storyId}'}/draft</code> — the Working Draft&apos;s scene list,
          with staleness
        </li>
        <li>
          <code>GET /api/stories/{'{storyId}'}/inspector?scene=N</code> — both inspector tabs at
          one scrubber position
        </li>
        <li>
          <code>GET /api/stories/{'{storyId}'}/run-report</code> — runs aggregated by Scene Card
        </li>
        <li>
          <code>GET /api/tellings/{'{runId}'}/report</code> — one run&apos;s full report
        </li>
      </ul>

      <h2>Author surfaces</h2>
      <p className="meta">
        The four surfaces ADR 0016 settled on. Compiling a scene, resolving a proposal and
        promoting a run are writes, and a deployment asks for the same{' '}
        <code>BLOB_READ_WRITE_TOKEN</code> every other write surface uses; a local
        filesystem-backed instance asks for nothing.
      </p>
      <ul className="paths">
        <li>
          <code>/stories/{'{storyId}'}</code> — Working Draft, stale badges, and the scene compile
          view (diagnostics + proposals queue)
        </li>
        <li>
          <code>/stories/{'{storyId}'}/inspector</code> — World Model and told-ledger over one
          scene-index scrubber
        </li>
        <li>
          <code>/stories/{'{storyId}'}/runs</code> — run report and the manual Baked promotion
        </li>
      </ul>

      <h2>Admin</h2>
      <ul className="paths">
        <li>
          <Link href="/admin/load-fixtures">/admin/load-fixtures</Link> — (re)load both fixture
          Story Packages, from a browser
        </li>
      </ul>
    </main>
  );
}
