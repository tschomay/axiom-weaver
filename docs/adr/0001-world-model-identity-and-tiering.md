# ADR 0001: World Model identity, tiering, and column-vs-edge shape

## Status

Accepted — settled in [Schemas for the Story Package and World Model](https://github.com/tschomay/axiom-weaver/issues/2).

## Context

The World Model (`CONTEXT.md`) needs a concrete schema before nearly any other ticket on the map
can proceed — Scene Digests, the plant-obligation walk, state-update authority (issue #9), and
context assembly all read entities, relationships, and tiered properties. Four structural
questions had to be settled before column lists were more than bikeshedding: how entities are
identified and referenced, how a property's write-authority tier is declared, whether a fact
lives as a table column or as a relationship edge / join table, and how open-ended
author-invented attributes are shaped.

## Decision

1. **Identity is a stable slug id, assigned at authoring time, never a name.** `name` is an
   ordinary mutable column. All cross-references (Scene Cards, relationships, digests, the
   told-ledger) store the id. A rename is a one-column update with no cascading changes.
2. **A property's tier (physical / epistemic / volitional) is declared once per column in the
   schema, never per row or per instance.** Tier answers "what kind of fact is this", which is
   static — `character.location_id` is always physical. This lets the validator in issue #9
   reason about engine write-authority statically, without consulting data. Bag columns carry no
   tier and are never engine-writable.
3. **A fact is a table column when it's single-valued; it's a relationship edge or a join table
   when it's multi-valued and grows over the story.** Location (one value at a time) is a column.
   Possessions (many objects, changing) are `relationship` edges. In-world knowledge (many facts,
   accumulating) is a dedicated `character_knowledge` join table, not a column. Applying this
   consistently avoids ad hoc denormalization decisions on a per-table basis.
4. **The open key-value bag holds flat scalars only — no nested structure.** The moment an
   author-invented attribute needs structure, that's the signal it should be promoted to a core
   column instead.

See [`docs/schema/story-package.md`](../schema/story-package.md) for the full table definitions
this produced.

## Consequences

- Issue #9 (state-update authority) can build its validator against a fixed, statically-knowable
  set of (column, tier) pairs, rather than inspecting row data to determine write authority.
- Adding a new mutable fact to the World Model later means answering "is this single-valued or
  growing" before choosing column vs. edge/join-table — a repeatable test rather than a fresh
  judgment call each time.
- The bag being flat-only means any future need for structured author attributes will surface as
  a deliberate schema change (a new core column), not a silent schema drift inside JSON blobs.
- Renaming, reordering, or restructuring entities never touches Scene Cards or relationships,
  because none of them reference by name.
