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
        read. This deployment carries the persistence layer only — the World Model, the Story
        Package schema, the state-update commit log, and the state-update authority validator.
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
            <h3>{story.title}</h3>
            <p className="meta">
              {story.storyId} · package_version {story.packageVersion} (retained:{' '}
              {story.retainedVersions.join(', ')}) · {story.scenes} scene cards · {story.entities}{' '}
              entities
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
