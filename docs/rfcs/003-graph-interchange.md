# RFC-003: Versioned graph interchange format

- Status: Accepted for plain JSON v1; archive extension superseded by RFC-006
- Date: 2026-08-05

## Goals

The native interchange format must preserve graph semantics, immutable content,
generation provenance, layout, and attachments without containing credentials.
It must support validation, transactional import, deterministic export, and
future migrations.

## Version 1 container

Version 1 is canonical UTF-8 JSON with the format identifier `waterlily/graph`,
schema version `1`, exporter metadata, an immutable graph snapshot, positions,
and presentation groups. It is supported only when the graph contains no
attachment blocks.

Portable attachment-bearing workspaces are specified separately by RFC-006 as
`.waterlily` archives. Plain JSON remains intentionally attachment-free.

## Plain JSON v1 import behavior

1. Enforce a configurable byte limit before parsing.
2. Require the exact versioned envelope and validate the embedded graph and view
   state, including causal acyclicity and group membership.
3. Reject attachment blocks and credential-shaped object fields.
4. Offer a validated import preview to application callers.
5. Clone or merge atomically, remapping every identifier while recording source
   graph, node, and revision identifiers in revision metadata.

The first version clones imported graphs. Live cross-workspace references are
out of scope because their deletion and permission semantics are unresolved.

## Compatibility

- Readers accept the current schema and explicitly supported older schemas.
- Migrations are pure, ordered functions covered by golden fixtures.
- Writers emit only the current schema.
- Unknown required fields or future major versions fail without partial import.
- External ChatGPT, Claude, LibreChat, and CTK adapters translate into this
  format outside the core schema package.

## Plain JSON v1 acceptance evidence

- A published JSON Schema describes the exact v1 envelope; strict runtime
  validation covers valid and invalid documents.
- Deterministic canonical export and SHA-256 hashes are tested.
- Export/import/export semantic equality, clone/merge behavior, identifier
  collision handling, pinned revision remapping, view remapping, byte limits,
  credential-field rejection, attachment rejection, and graph invariant
  rejection are tested.
- The package has 36 passing tests and exceeds 97% in every coverage dimension.

## Archive relationship

RFC-006 accepts the ZIP extension with checksum, path, expansion, credential,
attachment restoration, and workspace-state rules. It does not change this plain
JSON schema.
