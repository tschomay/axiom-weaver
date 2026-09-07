# ADR 0008: The zoom-level context assembler

## Status

Accepted — settled in [The zoom-level context assembler](https://github.com/tschomay/axiom-weaver/issues/12),
prototyped on the throwaway branch `prototype/context-assembler`
([prototype file](https://github.com/tschomay/axiom-weaver/blob/prototype/context-assembler/prototypes/context-assembler.prototype.html)).

## Context

[Gemini capabilities the compiler depends on](https://github.com/tschomay/axiom-weaver/issues/5)
(`docs/research/gemini-capabilities.md`) changed the shape of this ticket before it started:
caching is a **prefix match, not a diff**, which turns "gather the relevant things" into an
**ordering** problem, and function calling's turn-boundary nature rules out a `lookup(entity)`
tool in the writer call. Both findings are binding inputs here, not open questions to
re-litigate.

`CONTEXT.md` described the digest hierarchy as two named rollup levels — Chapter Digests for
the current part, Part Digests for the whole book — and claimed this grows "logarithmically
with book length." The prototype exposed that this claim is false for a **fixed** two-level
scheme: the Part-Digest band has nothing to roll up *into*, so it grows one entry per part for
the life of the book — linear, not logarithmic, just with a large divisor. At short-story POC
scale this is invisible; the ticket's own instruction to measure "a simulated scene 250" is
what was meant to surface it.

## Decision

1. **The digest hierarchy is recursive and unbounded in depth, not fixed at two rollup
   levels.** Every level holds at most `W` items (a configurable window, prototyped at
   `W = 4`). Pushing a new Scene Digest onto level 0 cascades upward exactly like carrying a
   digit in base-`W` counting: whenever a level reaches `W` items, all of them roll up into one
   item appended to the next level and the level is cleared. Level 0 is Scene Digests (per
   `CONTEXT.md`/ADR 0003), level 1 is Chapter Digests, level 2 is Part Digests — those three
   names stay exactly as `CONTEXT.md` already uses them — and level 3+ are **Book Digests
   (`L3`, `L4`, …)**, a new name this ADR introduces because the two-level framing has no name
   for what a sufficiently long novel needs. A short story never grows past level 1; the
   prototype's synthetic 600-scene run reaches level 4. This is what actually delivers the
   "logarithmic growth" `CONTEXT.md` already claims — the two-level version did not.

2. **Chapter/Part/Book are compiler-internal resolution windows, not the authored book's
   chapter breaks.** They are sized by scene count (`W`), not by any reader-facing structure.
   This was a deliberate fork: an alternative giving Scene Card an author-declared
   `chapter_id`/`part_id` was rejected because the reader-facing "Chapter 3" heading is app-shell
   work (out of scope per the map), and coupling the assembler's cache-boundary windows to
   authored chapter breaks would make cache behavior depend on how evenly an author happens to
   chapter their book — a fragile dependency for no benefit. **No change to
   `docs/schema/story-package.md` is needed.**

3. **Payload order, coarsest to most volatile** — the mandated shape from `docs/research/gemini-capabilities.md` §2, made concrete:

   | Segment | Cache mechanism | Volatility |
   | --- | --- | --- |
   | Writer contract, Voice Card (rendered per [ADR 0007](0007-voice-card-and-style-presets.md) §3), World Model *schema*/tier definitions, Story Package metadata | **explicit** `CachedContent` | never changes within a read |
   | Book Digests (`L3+`, oldest first), then Part Digests, then Chapter Digests, then open Scene Digests | **implicit** prefix cache | append-only; a band resets to empty exactly when it rolls up |
   | Verbatim tail — the **final paragraph of the previously generated prose** (not a fixed word count, and not the digest's `closing_situation`, which is a summary; a hard length backstop trims only if one paragraph is unreasonably long) | uncached | replaced every scene |
   | Current Scene Card, this scene's plant obligations (ADR 0004's templated instructions), filtered World Model rows, told-ledger slice | uncached | mutates every scene |

   Explicit caching is used **only** for the header: `CachedContent`'s fields are immutable
   (`docs/research/gemini-capabilities.md` §2), so it cannot absorb the digest hierarchy's
   appends without being recreated every scene. The digest hierarchy and tail rely on
   *implicit* per-request prefix matching instead, which works correctly as long as ordering
   is respected — confirmed by the prototype's chunk-identity cache simulation (below).

4. **Filtering is a deterministic join off the Scene Card's own fields, never inferred from
   prose.** "Present" means named in `characters_present`, full stop — not also implied by the
   previous scene's `closing_situation`, which is freeform prose and would make presence
   non-deterministic. World Model rows in scope: characters in `characters_present`; the
   `location` row for `location_id`; objects there or held (`possesses`) by a present character;
   relationships touching at least one present entity; `character_knowledge` rows for present
   characters. This is the "join, not a judgement" the research recommended.

5. **No lookup tool — retrieval is the join in (4), plus a diagnostic for what it misses.** The
   writer's `diagnostics` output field (already established as part of the one-response
   contract, `docs/research/gemini-capabilities.md` §1, owned by
   [the writer prompt contract](https://github.com/tschomay/axiom-weaver/issues/16)) carries a
   `missing_fact` entry when the writer needed something it wasn't given. Read-time this logs
   to the run report; author-time it surfaces immediately, the same escalation pattern as every
   other diagnostic in `CONTEXT.md`. This closes the loop the pre-stuff-vs-lookup tradeoff opened
   without reopening the tool question §4's research already closed.

6. **Volatile-tail budget and eviction order — what is sacrificed first.** A fixed token budget
   applies to the volatile tail. The **mandatory core** (Scene Card, plant obligations, present
   characters/location/objects) is never dropped; if it alone exceeds the budget, that is logged
   as a diagnostic that the scene needs a larger allowance, not a signal to trim harder. Beyond
   the core, groups are included in priority order and the lowest-priority group is dropped
   first once the budget is exhausted:

   1. Told-ledger rows for **this scene's own** fact-refs (`reader_must_learn` /
      `must_stay_hidden` / `pays_off`) — tightly load-bearing for the variance contract (ADR
      0006) and the told-ledger mechanism (ADR 0003) itself.
   2. Relationships between two present entities.
   3. Relationships touching one present entity.
   4. `character_knowledge` rows tied to this scene's own facts.
   5. Other `character_knowledge` rows for present characters (broader epistemic context).
   6. A broader told-ledger recency slice, for re-anchoring context — this is
      [Re-anchoring policy](https://github.com/tschomay/axiom-weaver/issues/13)'s territory to
      refine; #12 only needs *a* slice definition to hand off, and the widest, lowest-priority
      one is it.

7. **Rollup trigger timing is now settled, not fog.** A level's rollup fires the instant it
   fills — after every scene, bottom-up, cascading exactly as (1) describes. This is
   independent of any author-time boundary. At a read's end an open (partial) band simply stays
   as individual digests; nothing forces a rollup at EOF. Each rollup event is "one expensive
   scene" (the prompt's prefix is spliced at that band's position, per
   `docs/research/gemini-capabilities.md` §2) — and rollups get **exponentially rarer** at
   higher levels (`W` scenes per level-0→1 rollup, `W²` per level-1→2, `W³` per level-2→3, …),
   so the amortized cost stays small even though any single rollup scene is not cache-cheap.

## What the prototype measured

Window `W = 4`, header fixed at 15,000 tokens (the size `docs/research/gemini-capabilities.md`
assumed), digest sizes measured from real content (the Cinderella fixture) or realistic
synthetic content (novel-scale run):

| Scene | Total prompt tokens | Cached tokens | Cache-hit fraction | Deepest open level |
| --- | --- | --- | --- | --- |
| 3 | 16,266 | 15,101 | 93% | 1 (Chapter) |
| 20 | 16,555 | 15,387 | 93% | 2 (Part) |
| 100 | 16,950 | 15,781 | 93% | 3 (Book L3) |
| 250 | 17,715 | 16,544 | 93% | 3 (Book L3) |
| 600 | 17,487 | 16,316 | 93% | 4 (Book L4) |

**Total prompt size stays essentially flat (~16.3k–17.7k tokens) from scene 3 through scene
600.** This is a materially better number than the flat, ungoverned digest hierarchy
`docs/research/gemini-capabilities.md` §2 measured for its own worked example (45,000 tokens of
digest hierarchy alone at 600 scenes, on top of everything else) — the recursive rollup in
decision (1) is what makes the difference, and it is the concrete answer to the ticket's own
instruction: *"if growth isn't roughly logarithmic, the design has a leak — find it."* The leak
was the fixed two-level assumption; the fix is decision (1).

**The ordering mistake is real but bounded, and recovering from it costs one extra scene.**
Placing the volatile tail right after the header (violating decision 3) at scene 250 dropped the
cache-hit fraction from 93% to 85% for that call — 1,544 tokens rebilled at full price that
would otherwise have been ~90%-discounted. Flipping the order back does **not** recover the
cache on the very next scene: that scene's prompt is still being prefix-compared against the
actual (wrongly-ordered) bytes sent last call, so the fraction stays low for one more scene
before recovering. Because decision (1) already bounds the digest hierarchy's size, this mistake
costs a fixed, modest amount at *any* scale — in a design without decision (1), the same mistake
would grow arbitrarily more expensive as the book lengthens, since there would be more
accumulated cache to throw away each time.

## Consequences

- Unblocks [The writer prompt contract](https://github.com/tschomay/axiom-weaver/issues/16)
  (its other blockers — #8, #9, #11 — are already closed), which now has a concrete payload,
  order, cache-boundary, and eviction spec to build its output schema against, plus the
  `missing_fact` diagnostic requirement from decision (5).
- Substantially resolves the map's "Rollup trigger policy at true novel scale" fog item:
  timing is fixed (decision 7) and its cost is quantified (measurement table above). The
  fog item's cache-invalidation dimension (raised by #5) is answered by the same table.
- Narrows, but does not close, the "Cost and latency envelope per read at novel scale" fog
  item: the digest-hierarchy component of that cost no longer grows with book length, but a
  measured end-to-end per-scene cost and latency still waits on #16 existing, as already noted.
- `docs/schema/story-package.md` needs **no changes** — decision (2) was a deliberate schema
  fork this ADR rejects, not a gap to fill later.
- `CONTEXT.md`'s "Zoom levels" bullet is updated to describe the recursive hierarchy and the
  corrected growth claim, with a pointer here.
