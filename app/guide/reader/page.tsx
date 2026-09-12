import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "Reader's Guide — Axiom Weaver",
  description:
    'What stays the same and what varies each time you read an Axiom Weaver story, and how to use the three-way read screen.',
};

/**
 * The reader-facing counterpart to the Author's Guide. No mechanism detail beyond what a reader
 * actually experiences on `/stories/{storyId}/read` (ADR 0014 §3/§4) — this is not a second copy
 * of the run-loop spec.
 */
export default function ReaderGuidePage() {
  return (
    <main>
      <p className="meta">
        <Link href="/">← stories</Link>
      </p>
      <h1>Reader&apos;s Guide</h1>
      <p className="lede">
        Every story here was written once, completely, by its author. What you get is a{' '}
        <em>performance</em> of it — the same plot, the same facts, the same beats, told in prose
        that&apos;s composed fresh each time you ask for a new telling. Read it twice and you&apos;ll
        recognize everything that happens and rarely recognize a sentence.
      </p>

      <h2>What stays the same, what varies</h2>
      <p>
        The author fixes exactly what matters to the plot: the events, who is present, what you
        learn and when, what a scene must leave true by the time it ends. None of that ever
        changes between readings — nothing is ever left to chance about what <em>happens</em>.
      </p>
      <p>
        What&apos;s never fixed is how it&apos;s told: the exact wording, which images get used, a
        line of dialogue&apos;s phrasing, the small order details get mentioned in. That&apos;s the part
        that&apos;s free to come out differently every time, and it&apos;s the whole reason two tellings
        of the same story are worth reading side by side instead of being the same text twice.
      </p>

      <h2>Your three ways to read</h2>
      <p>
        Open any story&apos;s <code>/read</code> screen and you get a choice, every time:
      </p>
      <ul>
        <li>
          <strong>The Baked edition</strong> — a fixed, known-good telling the author has chosen as
          the default. If you just want to read the story once, reliably, start here.
        </li>
        <li>
          <strong>The library</strong> — past tellings the author has saved and named because they
          were worth telling apart from the rest. There are no reader accounts, so this list is the
          author&apos;s curation, not a personal collection of yours.
        </li>
        <li>
          <strong>Generate a new telling</strong> — ask the compiler for a telling nobody has read
          yet. This is the same machinery behind everything else in the system, run for you, live.
        </li>
      </ul>

      <h2>Generating a telling</h2>
      <p>
        Press it and you&apos;ll see a wall-clock estimate up front — never a cost, just how long it
        should take, based on the story&apos;s scene count and how long its scenes have taken before.
        Then a progress line, &quot;compiling scene 7 of 14&quot;, rather than words streaming in as
        they&apos;re written — the compiler builds the whole edition before handing any of it back, so
        what you eventually read is never a half-finished draft.
      </p>
      <p>
        You can leave and come back: your still-in-flight run stays yours to rejoin, and every
        completed telling gets its own permanent, shareable link the moment it finishes — reading
        it again later, or sending it to someone else, doesn&apos;t cost anything or change what&apos;s
        in it. If progress stalls for a while, you&apos;ll be offered the Baked edition rather than
        being left staring at a bar that stopped moving.
      </p>
      <p>
        Once in a great while a scene has trouble and the compiler quietly falls back rather than
        stalling the whole run — you won&apos;t normally notice, and a run affected badly enough to
        matter is marked as such rather than passed off as clean.
      </p>

      <h2>Sharing what you read</h2>
      <p>
        A telling&apos;s link shows only what you read — the prose and the digested summary behind
        it — never the Story Package the author wrote it from. The score stays the author&apos;s; only
        the performance is yours to pass around.
      </p>

      <h2>If the model&apos;s daily allowance runs out</h2>
      <p>
        The writer model behind these tellings runs on a rate-limited key, and once its daily
        allowance is spent, no retry helps until it resets. Rather than fail outright, the read
        screen will offer a lighter model with its own separate, much larger allowance — offered,
        never switched to silently, because a quality change you didn&apos;t ask for is worse than a
        wait. Whatever wrote a scene is recorded as having written it.
      </p>

      <h2>Nothing to sign up for</h2>
      <p>
        There are no reader accounts and nothing to remember between visits beyond the links you
        keep. Every completed telling is addressable and shareable by its own link indefinitely —
        nothing you read is ever deleted out from under a link you saved.
      </p>

      <p className="meta">
        Curious how a story like this gets written in the first place? See the{' '}
        <Link href="/guide/author">Author&apos;s Guide</Link>.
      </p>
    </main>
  );
}
