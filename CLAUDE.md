Agent configuration for this repo lives in [`AGENTS.md`](./AGENTS.md), not here — read it for the issue tracker, domain docs, and other agent-skill setup.

## Blob storage token — read-only

`BLOB_READ_WRITE_TOKEN` in the cloud environment is the **production** Vercel Blob store's token,
with full read/write/delete. Treat it as read-only:

- **Reading production is fine** — `get`/`head`/`list` (e.g. a telling's `edition/{runId}/*.json`
  to diagnose it). Tell the user what you're about to read and why before you do it.
- **Never write, overwrite or delete** production blobs, directly or through app code (compiles,
  `npm run telling`, `compare`, `load-fixtures`, imports, promote, delete routes, `next dev`).
- **Experiments still run as before, locally.** `createBlobStore()` (`src/persistence/index.ts`)
  picks Vercel Blob whenever the token is set and the `.data/` filesystem store otherwise, so run
  every script and the dev server with the token unset:
  `env -u BLOB_READ_WRITE_TOKEN npm run telling -- ...`. That is the path all earlier experiment
  runs used (none ever reached the UI). The test suite already deletes the token itself.
- To study a production telling locally, read its files and copy them into `.data/` — never the
  other direction.
