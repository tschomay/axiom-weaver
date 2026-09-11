import Link from 'next/link';
import { storyRepository } from '@/persistence';
import { WorldModel } from '@/world-model/world-model';

export const dynamic = 'force-dynamic';

interface StorySummary {
  storyId: string;
  title: string;
  /** `null` for a story that exists only as a draft and has never published. */
  packageVersion: number | null;
  retainedVersions: number[];
  scenes: number;
  entities: number;
  editing: boolean;
}

async function summaries(): Promise<StorySummary[]> {
  const repository = storyRepository();
  const storyIds = await repository.listStoryIds();

  const rows: StorySummary[] = [];
  for (const storyId of storyIds) {
    const pkg = await repository.getCurrentPackage(storyId);
    const manuscript = await repository.getManuscript(storyId);

    // A story that has never published is still a story: it has a draft, and the list is where an
    // author goes looking for it. Counting it needs the unchecked seed — a draft is allowed to
    // hold references that do not resolve yet, which is exactly what the linter is for.
    if (pkg === null) {
      if (manuscript === null) continue;
      const seed = manuscript.package.world_model_seed;
      rows.push({
        storyId,
        title: manuscript.package.metadata.title,
        packageVersion: null,
        retainedVersions: [],
        scenes: manuscript.package.scene_cards.length,
        entities: seed.characters.length + seed.locations.length + seed.objects.length,
        editing: true,
      });
      continue;
    }

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
      editing: manuscript !== null,
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
      <p className="meta">
        <Link href="/stories/new">Start a story →</Link>
      </p>
      {stories.length === 0 ? (
        <div className="empty-note">
          <p>
            No stories yet. <Link href="/stories/new">Start one from scratch</Link> — or load the
            five fixtures and duplicate one, which is the easier first hour: they come with a
            complete plant chain and a filled Voice Card to work from.
          </p>
          <p className="meta">
            Fixtures load from <Link href="/admin/load-fixtures">/admin/load-fixtures</Link> in a
            browser, or <code>npm run load-fixtures</code> in a terminal.
          </p>
        </div>
      ) : (
        stories.map((story) => (
          <div className="story" key={story.storyId}>
            <h3>
              {/* A draft has no Working Draft to open, so its name opens the one screen it has. */}
              <Link
                href={
                  story.packageVersion === null
                    ? `/stories/${story.storyId}/edit`
                    : `/stories/${story.storyId}`
                }
              >
                {story.title === '' ? story.storyId : story.title}
              </Link>
            </h3>
            <p className="meta">
              {story.storyId} ·{' '}
              {story.packageVersion === null
                ? 'draft — never published'
                : `package_version ${story.packageVersion} (retained: ${story.retainedVersions.join(', ')})`}{' '}
              · {story.scenes} scene cards · {story.entities} entities
              {story.editing && story.packageVersion !== null ? ' · unpublished edits' : ''}
            </p>
            <p className="meta">
              {story.packageVersion === null ? null : (
                <>
                  <Link href={`/stories/${story.storyId}`}>Working Draft</Link> ·{' '}
                  <Link href={`/stories/${story.storyId}/inspector`}>World &amp; Discourse</Link> ·{' '}
                  <Link href={`/stories/${story.storyId}/runs`}>Run report</Link> ·{' '}
                </>
              )}
              <Link href={`/stories/${story.storyId}/edit`}>
                {story.editing ? 'Continue editing' : 'Edit'}
              </Link>
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
        The four surfaces ADR 0016 settled on, plus the authoring screen ADR 0017 adds. Compiling
        a scene, resolving a proposal, promoting a run and saving a draft are writes, and a
        deployment asks for the same{' '}
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
        <li>
          <code>/stories/{'{storyId}'}/edit</code> — the Manuscript: metadata, Voice Card, World
          Model seed, the linter, and publish
        </li>
        <li>
          <Link href="/stories/new">/stories/new</Link> — start a story from scratch, or duplicate
          a retained version of an existing one
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
