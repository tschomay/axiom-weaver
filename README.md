# Axiom Weaver

The Dynamic Novel Compiler. A story is authored once as a structured **Story Package** and
*performed* into prose on every read — same story, told uniquely each time.

Start with [`CONTEXT.md`](./CONTEXT.md) for the ubiquitous language,
[`docs/schema/story-package.md`](./docs/schema/story-package.md) for the schema, and
[`docs/adr/`](./docs/adr/) for the decisions behind it. Agent setup is in
[`AGENTS.md`](./AGENTS.md).

## What is built

The persistence half of the compiler — everything that does not need the writer call
([#40](https://github.com/tschomay/axiom-weaver/issues/40)), the run loop
([#41](https://github.com/tschomay/axiom-weaver/issues/41)), or a real UI
([#42](https://github.com/tschomay/axiom-weaver/issues/42)).

| Area | Where | Fixed by |
| --- | --- | --- |
| Story Package envelope, World Model tables, Scene Card | `src/schema/story-package.ts` | `docs/schema/story-package.md` |
| Per-column write-authority tiers (P / E / V) | `src/schema/tiers.ts` | ADR 0001 |
| The normalized `state_updates` shape | `src/schema/state-update.ts` | ADR 0005 |
| The World Model tables | `src/world-model/world-model.ts` | ADR 0001 |
| The state-update commit log and "as of scene N" replay | `src/world-model/state-log.ts` | ADR 0016 §2 |
| State-update authority: entry check, accept/reject/flag, proposals | `src/validator/state-update-authority.ts` | ADR 0005, ADR 0016 §3 |
| Diagnostics and their surfaces | `src/validator/diagnostics.ts` | ADR 0005 §5, ADR 0016 §4 |
| Blob layout, retained `package_version` snapshots | `src/persistence/` | ADR 0015 §2/§4 |
| Fixture loading and cross-reference checking | `src/fixtures/load.ts` | — |

What loading the two fixtures through all of it turned up is in
[`docs/schema/fixture-conformance-findings.md`](./docs/schema/fixture-conformance-findings.md).

## Running it

```bash
npm install
npm run load-fixtures   # retain both fixture Story Packages
npm run dev             # http://localhost:3000
```

`npm test` runs the suite; `npm run typecheck` and `npm run lint` are the other two fast checks.

### Storage

Persistence goes through a `BlobStore` interface with two implementations. With
`BLOB_READ_WRITE_TOKEN` set, writes go to a private Vercel Blob store; without one they go to the
filesystem under `.data/` (gitignored) at exactly the same pathnames. See `.env.example` and
`src/persistence/paths.ts` for the layout.

### Read surfaces

| Route | What it serves |
| --- | --- |
| `GET /api/stories` | every story with a retained package |
| `GET /api/stories/{storyId}/package` | the current Story Package, through the pointer |
| `GET /api/stories/{storyId}/package/{version}` | a retained snapshot — what an edition's pinned version dereferences to |
| `GET /api/stories/{storyId}/world-model?scene=N` | the World Model as of scene N, replayed from the commit log |
| `GET /api/stories/{storyId}/proposals` | the proposals queue: volitional proposals awaiting the author |
