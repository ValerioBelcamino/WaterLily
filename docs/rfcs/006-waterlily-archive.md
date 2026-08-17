# RFC-006: Portable `.waterlily` workspace archive

- Status: Accepted
- Date: 2026-08-17

## Goals

One file must be sufficient to share, resume, or merge an attachment-bearing
WaterLily conversation without exporting credentials. Importing an untrusted
file must fail before graph mutation when its structure, contents, or size is
invalid.

## Version 1 container

The file extension is `.waterlily`; the media type is
`application/vnd.waterlily+zip`. The bytes are a deterministic ZIP archive for a
fixed input:

```text
manifest.json
workspace.json
attachments/<sha256>.blob
```

`workspace.json` is canonical UTF-8 JSON containing the immutable graph and
workspace state version 1: context selections, canvas positions, and groups. The
manifest has the exact format identifier `waterlily/archive`, schema version
`1`, canonical export timestamp, exporter name/version, a workspace path/size/
SHA-256 tuple, and an ordered list of attachment descriptors. Each attachment
descriptor includes its local ID, original name, media type, byte size, SHA-256,
and canonical content-addressed path.

All graph attachment references must have exactly one manifest descriptor, and
all descriptors must be referenced. Files with the same content may share one
ZIP entry while retaining distinct descriptors.

## Validation and limits

Readers reject the archive before returning a workspace when any of these
conditions hold:

- a ZIP entry is absolute, contains `..`, uses backslashes, is duplicated, or is
  not declared by the manifest;
- the manifest/workspace has missing, extra, malformed, future-version, or
  credential-shaped fields;
- a workspace or attachment byte length or SHA-256 differs from the manifest;
- the graph, current revisions, typed edges, layout, groups, or context block
  selections violate their domain invariants;
- graph attachment references and supplied attachment descriptors differ; or
- configured compressed-byte, expanded-byte, entry-count, attachment-count, or
  per-attachment limits are exceeded.

Default limits are 128 MiB compressed, 256 MiB expanded, 66 entries, 64
attachments, and 10 MiB per attachment. Applications may lower these limits.

Credential-like keys are forbidden recursively in graph metadata, workspace
state, and the manifest. Provider profiles and keys are not archive fields and
are never consulted by the exporter.

## Import semantics

1. Parse the complete ZIP and validate every checksum and workspace invariant.
2. Restore each attachment into local storage and record the new descriptor.
3. Rewrite attachment blocks to those new local IDs.
4. Remap every node, revision, edge, and group ID; remap context-selection node
   IDs with the same mapping.
5. Merge into the active graph and persist the resulting workspace once.
6. If upload, remapping, or persistence fails, leave the visible workspace
   unchanged and attempt to delete every attachment uploaded by this import.

Step 6 is a compensating transaction rather than a database/filesystem atomic
transaction. A process crash between blob creation and workspace commit can
leave an unreachable blob, so a future garbage collector must remove orphaned
attachments.

## Compatibility

Readers accept only explicitly supported schema versions. Writers emit version

1. A future version that changes required semantics must add a pure migration or
   fail closed. RFC-003 JSON import remains supported as a separate,
   deliberately attachment-free integration format.

## Acceptance evidence

- Deterministic round trips cover attachment-bearing and attachment-free
  workspaces, layout, groups, and context selections.
- Tests cover corrupted workspace and attachment hashes, missing/unexpected and
  unsafe ZIP paths, exact attachment sets, credentials, size/entry limits,
  invalid context state, and unsupported archives.
- Browser/service tests cover byte download/delete, attachment ID rewriting,
  collision-safe workspace merge, one committed save, and rollback deletion.
- Chromium E2E downloads a real `.waterlily` file containing an attachment,
  imports that file, and observes the restored graph and attachment nodes.
