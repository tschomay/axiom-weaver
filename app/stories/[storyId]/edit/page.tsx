import { notFound } from 'next/navigation';
import { storyRepository } from '@/persistence';
import { lintPackage } from '@/authoring/lint';
import { nextPackageVersion } from '@/authoring/manuscript';
import { isEditorSection } from '@/authoring/editor-model';
import { BeginEditing } from './begin-editing';
import { EditView } from './edit-view';

export const dynamic = 'force-dynamic';

/**
 * The fifth author surface (ADR 0017, issue #88).
 *
 * ADR 0016's four surfaces were scoped to screens that *feed the mechanics* with what the compiler
 * produces. This one runs the other way: it is where the Story Package those mechanics consume
 * comes from.
 */
export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { storyId } = await params;
  const repository = storyRepository();
  const [manuscript, pkg] = await Promise.all([
    repository.getManuscript(storyId),
    repository.getCurrentPackage(storyId),
  ]);

  if (manuscript === null) {
    if (pkg === null) notFound();
    return (
      <BeginEditing storyId={storyId} title={pkg.metadata.title} version={pkg.package_version} />
    );
  }

  // Linted against the version publishing *would* write, not against the one the draft carries:
  // the author is looking at what the next publish produces, so that is what to check.
  // Read here as well as in the browser so a link to a section opens on that section, rather
  // than rendering the first one and then replacing it (ADR 0017 §7).
  const section = (await searchParams)['section'];
  const named = typeof section === 'string' && isEditorSection(section) ? section : null;

  const nextVersion = await nextPackageVersion(repository, storyId);
  return (
    <EditView
      storyId={storyId}
      published={pkg !== null}
      initialSection={named}
      initial={{
        ...manuscript,
        lint: lintPackage({ ...manuscript.package, package_version: nextVersion }),
        next_package_version: nextVersion,
      }}
    />
  );
}
