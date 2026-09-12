import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "Author's Guide — Axiom Weaver",
  description:
    'How to write a Story Package, compile it into a Working Draft, and publish it — the author-side walkthrough of Axiom Weaver.',
};

/**
 * A prose walkthrough of the author-facing surfaces (ADR 0016, ADR 0017), for someone who wants
 * to write a story rather than read the ADRs that specify the screens. Every claim here should
 * trace to something a screen actually does — this is a guide, not a second spec.
 */
export default function AuthorGuidePage() {
  return (
    <main>
      <p className="meta">
        <Link href="/">← stories</Link>
      </p>
      <h1>Author&apos;s Guide</h1>
      <p className="lede">
        You write a story once, completely and precisely, as structured data — a{' '}
        <strong>Story Package</strong>. The compiler performs it into prose on every read. Your
        job is the score, not the performance: you fix the world, the events, and the order they
        are shown in; the engine only ever chooses the sentences.
      </p>

      <h2>The three things you own</h2>
      <p>
        A Story Package is three parts, and each has its own editor section on the{' '}
        <code>/edit</code> screen:
      </p>
      <ul>
        <li>
          <strong>The World Model seed</strong> — the characters, locations, and objects that
          exist, and the relationships between them, before scene one starts. This is the{' '}
          <em>Fabula</em>: what is true.
        </li>
        <li>
          <strong>Scene Cards</strong> — the ordered sequence of scenes: who is present, whose POV,
          what must happen, what the reader must learn, what must stay hidden, and how the world
          changes by the end of it. This is the <em>Syuzhet</em>: the arrangement.
        </li>
        <li>
          <strong>The Voice Card</strong> — the narrator, as data: person, tense, distance,
          register, sentence rhythm, imagery palette, dialogue density. It shapes every scene&apos;s
          Performance without being part of the plot.
        </li>
      </ul>
      <p>
        The compiler only ever writes the fourth thing, <strong>Performance</strong> — the actual
        sentences — and only from what you specified. Anything a Scene Card leaves unsaid (exact
        phrasing, imagery, micro-beat order) is free to come out differently on every read; that
        freedom is the whole point, not a gap to close.
      </p>

      <h2>Starting a story</h2>
      <p>
        <Link href="/stories/new">/stories/new</Link> gives you three ways in: start completely
        from scratch, <strong>duplicate</strong> any retained version of any existing story under a
        new id, or <strong>import</strong> a package as JSON. Duplicating one of the five bundled
        fixtures is the fastest way to see a filled-in package before writing your own — they each
        ship a complete plant chain and a working Voice Card.
      </p>

      <h2>The Manuscript</h2>
      <p>
        Every edit you make lands in the <strong>Manuscript</strong> — your story&apos;s one mutable
        working copy. It autosaves as you type, and nothing else in the system can see it: the
        Working Draft, every reader-facing screen, and every past edition keep reading the
        published package until you publish again. A story can have a Manuscript and no published
        package at all — that&apos;s a story being written from scratch, and it&apos;s treated as
        loosely as you&apos;d expect: no scenes yet is fine, missing fields are fine, until you try
        to publish.
      </p>
      <p className="meta">
        Only one browser tab can hold the pen at a time — saving carries the timestamp you last
        read the Manuscript at, and a second tab that raced you gets refused rather than silently
        overwriting your work.
      </p>

      <h2>Filling in the World Model seed</h2>
      <p>
        Every reference you make elsewhere in the package — a scene&apos;s POV, a location, a
        relationship — is a picker over this seed, on purpose: an author picking from a list
        cannot produce a dangling reference the way hand-typed ids can. Each entity carries a fixed
        core (name, description, the columns your schema defines) plus an open <strong>bag</strong>{' '}
        of key/value attributes for anything you invent that has no column of its own. Bag values
        stay flat — text, number, true/false, a list — so there is never a nested structure to lose
        track of.
      </p>

      <h2>Writing Scene Cards</h2>
      <p>
        Each Scene Card is the unit you author, and everything in it is a promise the compiler
        keeps exactly:
      </p>
      <ul>
        <li>
          <strong>Required beats</strong> — the tuning dial. Few beats and the performance is free
          to improvise widely between reads; many, and it stays close to identical prose each time.
          Set the density per scene as <code>tight</code>, <code>normal</code>, or <code>loose</code>.
        </li>
        <li>
          <strong>reader_must_learn / must_stay_hidden</strong> — facts the scene must reveal, and
          facts it must not. Both are checked mechanically against what the compiler actually
          produced.
        </li>
        <li>
          <strong>entry_state → exit_state</strong> — what must be true of the world when the scene
          starts, and what must be true when it ends. Edited as rows — entity, column, value — with
          each column&apos;s write-authority tier (physical/epistemic/volitional) shown beside it, so
          asserting a character&apos;s <code>goal</code> reads as the volitional claim it is.
        </li>
        <li>
          <strong>pays_off</strong> — for every fact this scene resolves, which earlier scene
          planted it (or that it was grounded in the World Model seed from the start). The picker
          only offers scenes that actually declare the fact — an undeclared plant is a hard
          authoring error, never a guess the compiler papers over.
        </li>
        <li>
          <strong>Invariants</strong> — the beats, facts, and exit state together are what stays
          fixed across every telling. Everything else about the scene is variance.
        </li>
      </ul>
      <p>
        Deleting a card that a later scene plants a payoff against tells you before the delete, not
        after.
      </p>

      <h2>The Voice Card</h2>
      <p>
        Five style presets — Fairy-Tale/Fable, Gothic/Brooding, Whimsical/Playful, Hardboiled/Terse,
        Lyrical/Literary — expand into a fully editable card rather than staying an opaque tag: pick
        one, then change any field, and your edit lives in your card, never as a diff against the
        shared preset. That matters because a preset can change later without silently changing a
        story you already told in it. A Scene Card&apos;s own <code>tone</code> field never edits the
        Voice Card — it&apos;s a separate, scene-scoped instruction layered alongside it.
      </p>

      <h2>Linting and publishing</h2>
      <p>
        The linter runs continuously beside the editor, and every problem it finds is a link to the
        exact field that owns it. It distinguishes two severities: an <strong>error</strong> is a
        defect that would otherwise fail at compile time, further from the field that caused it —
        publishing is blocked until it&apos;s fixed. A <strong>warning</strong> is a judgment call
        about craft you&apos;re allowed to disagree with, and it never blocks anything.
      </p>
      <p>
        <strong>Publish</strong> is the one deliberate act that turns your Manuscript into the next
        retained <code>package_version</code>: strict-parse, then lint, then{' '}
        <code>max(retained) + 1</code>, then retain the new version and point the story at it.
        Publishing leaves the Manuscript in place — you keep editing from where you left off.{' '}
        <strong>Discard</strong> is a separate, explicit action that drops the Manuscript and
        returns the story to whatever is currently published.
      </p>
      <p className="meta">
        Publishing is also the only moment a Working Draft can go stale — see below — because it&apos;s
        the only write that ever advances the version.
      </p>

      <h2>The Working Draft and the scene compile view</h2>
      <p>
        <code>/stories/{'{storyId}'}</code> is where you compile a story a card at a time, at
        author-time, with you in the loop. Compiling a scene shows you its diagnostics — an{' '}
        <code>error</code> or <code>warn</code> named against the exact field it contradicts — and
        adds any volitional proposal (a goal, an allegiance, a feeling the writer wants to assert)
        to a queue that waits for you to accept or reject it; leaving one pending never blocks
        compiling the next card.
      </p>
      <p>
        Editing an already-compiled scene and recompiling it flags every <em>later</em> scene in the
        draft <strong>stale</strong> — never auto-recompiled, never cascaded — with a popover
        carrying exactly what changed. Stale-but-standing is a legitimate state: nothing nags you,
        and a draft with stale scenes stays fully readable.
      </p>
      <p>
        A compile call costs one of the day&apos;s writer requests (see the note on the Gemini key
        below), so the Working Draft carries a <strong>compose from the Scene Card</strong> toggle:
        a stand-in writer that exercises validation, the continuity pass, and staleness without
        spending one. The compile view always says which of the two wrote a given scene.
      </p>

      <h2>The World &amp; Discourse inspector</h2>
      <p>
        <code>/stories/{'{storyId}'}/inspector</code> answers &quot;state as of scene N&quot; against a
        single scrubber, over two tabs that read the same position two different ways: the{' '}
        <strong>World Model</strong> tab answers what is true; the <strong>told-ledger</strong> tab
        answers what the reader has been told, and when. Neither is stored per scene — both are
        reconstructed by replaying the commit log up to that point.
      </p>

      <h2>The run report and promoting to Baked</h2>
      <p>
        <code>/stories/{'{storyId}'}/runs</code> aggregates every completed telling by Scene Card —
        &quot;this card degraded on 4 of 20 reads&quot; is the shape of what it tells you. A completed,
        non-degraded run can be <strong>promoted to Baked</strong> from here: the fixed, known-good
        edition a reader gets by default, so their first experience of your story is never a coin
        flip. Promotion is always manual — a degraded run can never be auto-promoted.
      </p>

      <h2>Comparing two tellings</h2>
      <p>
        <code>/stories/{'{storyId}'}/diff</code> puts two runs of the <em>same</em>{' '}
        <code>package_version</code> side by side: the Scene Digest fields that came out
        differently, the volitional proposals the two runs resolved differently, and both
        performances to read. It is deliberately never a line-level text diff of prose — two
        performances of one Scene Card can share almost no words and still be the same story told
        correctly twice. Comparing across two different versions is a different question — that&apos;s
        what staleness in the Working Draft is for.
      </p>

      <h2>Mind what a run costs</h2>
      <p>
        The project&apos;s Gemini key has billing attached, so a run is no longer rationed by a
        free tier&apos;s daily request cap — but a writer call still costs real money, and a rate
        or spend limit can still be hit under enough load. Prove the mechanism works with the
        stand-in writer or the much cheaper light model first, and save the real writer model for
        the run whose prose you actually intend to read. Every run report shows what it actually
        cost afterward, on <code>/stories/{'{storyId}'}/runs</code>; see <code>AGENTS.md</code> in
        the repository for the current tier&apos;s limits and how to pace requests against them.
      </p>

      <p className="meta">
        Looking for the reader&apos;s side of this instead? See the{' '}
        <Link href="/guide/reader">Reader&apos;s Guide</Link>.
      </p>
    </main>
  );
}
