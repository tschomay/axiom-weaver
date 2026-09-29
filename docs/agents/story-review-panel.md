# The Story Review Panel

A reusable reader-side eval: six reviewer agents, each owning one lens, read finished tellings as
a reader would and report findings with verbatim evidence. A curator then merges their reports
into recurring issues that can be traced back to a stage of the pipeline and fixed there.

It is the **Performance-layer** counterpart to the Fabula judge (`src/arc/judge.ts`,
`story-authoring-eval.md` §4.2), which deliberately judges the package and never prose. The panel
does the opposite: it judges only what reached the reader, and uses the package afterwards — in
curation, not review — to find out *where* a problem came from.

## The panel

Each reviewer is a Claude Code subagent in `.claude/agents/`. They share one output format and one
set of evidence rules (verbatim quote + scene for every finding, severity major/minor/nit, at most
eight findings per story, an anchored 1–5 score, a "what works" list so a fix doesn't break it).

| Agent | Lens | The question it asks |
| --- | --- | --- |
| `story-reviewer-consistency` | Logical consistency | Does this statement make sense given everything I've been told? |
| `story-reviewer-grounding` | Grounding and detail | Is this scene/fact set in its surround, or must I leap to follow it? |
| `story-reviewer-engagement` | Engagement and believability | Is this storyline engaging and believable? |
| `story-reviewer-character` | Character coherence | Do these people act like themselves, for reasons I can see? |
| `story-reviewer-payoff` | Setup and payoff | Did the story keep its promises, and were its surprises fair? |
| `story-reviewer-prose` | Prose craft | Is it well written, and does it read as one piece rather than stitched scenes? |

Two rules keep the lenses honest:

- **Reviewers read `story.md` only.** Not the package, not the run report, not the card ids.
  Knowing what the author meant is exactly what hides a gap in what the prose said.
- **One lens each.** Overlap is expected (an unmotivated confession is both a character and an
  engagement problem); each reviewer stays in its lane and notes the rest in one line, so the
  curator sees a problem once per lens rather than six times.

## Running it

### 1. Generate a sample — locally, never against production

```bash
env -u BLOB_READ_WRITE_TOKEN npm run review-sample                       # 5 stories: 5,8,12,16,22 events
env -u BLOB_READ_WRITE_TOKEN npm run review-sample -- --events 6,14      # any mix of sizes
env -u BLOB_READ_WRITE_TOKEN npm run review-sample -- --out prototypes/story-review/<name>
```

In a Claude Code cloud session, also set `NODE_USE_ENV_PROXY=1`: outbound HTTPS goes through a
proxy that Node's built-in `fetch` ignores otherwise, and the first Gemini call simply hangs.

`scripts/review-sample.ts` picks distinct premises at random from `RANDOM_PREMISES` (the Generate
tab's "surprise me" list) and runs each one through the app's own path — `generateArc` →
`segmentFabulaPackage` → lint/publish → `runTelling` — on `WRITER_MODEL`. It refuses to start if
`BLOB_READ_WRITE_TOKEN` is set (`CLAUDE.md`). Per story it writes, under
`prototypes/story-review/<date>/<NN>-<story_id>/`:

- `story.md` — the prose, one `## Scene N` per Scene Card, for reading;
- `package.json` — the published Story Package (Fabula, hidden account, Scene Cards) for tracing;
- `run.json` — models per stage, dollar cost, lint warnings, degraded scenes, diagnostics.

### 2. Convene the panel

Spawn one reviewer per lens, each over every `story.md` in the batch (six agents, not
six × stories — a reviewer that has read all of a batch can say "this recurs in 3 of 5"). In a
session that loaded `.claude/agents/`, use each as a `subagent_type`; otherwise spawn a
general-purpose agent and tell it to follow the agent file's instructions. A prompt as short as
this is enough:

> Follow `.claude/agents/story-reviewer-grounding.md`. Review every
> `prototypes/story-review/<batch>/*/story.md`.

Each writes `reviews/<lens>.md` beside the story it reviewed.

### 3. Curate

The panel's output is raw material, not the result. The curator (a person, or the session that
convened the panel) reads every review and produces `prototypes/story-review/<batch>/CURATION.md`:

1. **Verify.** Check each major finding's quote against `story.md`. Drop findings whose quote is
   not in the text, or whose "earlier statement" does not say what the reviewer claims. Reviewers
   over-report; a finding that doesn't survive a reread is noise.
2. **Merge across lenses.** The same defect usually appears under two or three lenses; record it
   once and note which lenses caught it (agreement across lenses is signal).
3. **Count across stories.** An issue in one story is an anecdote; in three of five it is a
   recurring issue. Rank by stories affected × severity.
4. **Trace to a stage.** For each recurring issue, open `package.json` and decide where it was
   introduced — this is what turns a complaint into a fix:
   - **Fabula** (`src/arc/`): the event list or hidden account itself lacks the cause, motive or
     plant. The prose couldn't have said what the arc never had.
   - **Segmentation** (`src/segmentation/`): the arc has it, but no Scene Card carries it, or a
     card's `required_beats` / `reader_must_learn` / `recounts` drop it.
   - **Performance** (`src/writer/`, `src/assembler/`, the Voice Card): the card has it and the
     prose didn't deliver, or delivered it twice, or dressed it in recycled imagery.
   - **Run loop / continuity** (`src/continuity/`, `src/edition/`): a cross-scene error the
     continuity pass or told-ledger should have caught.
5. **Recommend.** One concrete change per issue, at the stage it traced to, with the example that
   motivates it — and name the lens and score that should move if the fix works, so the next
   batch can check.

Keep the batch (stories, packages, reviews, curation) in the repo: the next panel run over the
same `--events` mix is how a fix is shown to have worked.

## Cost

A batch of five mixed-size stories is a handful of arc and segmentation calls plus one writer call
per scene; `run.json` records the exact dollar figure for each story. The panel itself is six
agent sessions reading a few tens of thousands of words.
