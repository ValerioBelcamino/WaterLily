# RFC-002: Deterministic context compilation

- Status: Accepted for initial implementation
- Date: 2026-08-05

## Goal

Compile one or more selected graph heads into an inspectable, deterministic,
provider-neutral context plan. Provider adapters serialize that plan into their
wire formats and persist the final request snapshot.

## Inputs

Each context head includes:

- Node identifier and optional pinned revision identifier.
- Human-visible label.
- Unique non-negative slot.

Compilation also receives a graph snapshot, an optional token budget and
estimator, and explicit inclusion overrides. An override targets either every
revision of a node or one exact revision and selects `full`, `blocks`, or
`excluded` content. Summaries and excerpts are explicit graph nodes rather than
invisible compiler transformations.

## Algorithm

1. Validate all heads, revisions, slots, and inclusion overrides.
2. Traverse only `context` edges backwards from each head.
3. Fail if the selected snapshot violates causal acyclicity.
4. Pin the current revision when a caller supplied only a node identifier.
5. For one head, emit one chronologically stable transcript segment.
6. For multiple heads, find nodes reachable from every head. Emit that shared
   ancestry once as the common segment.
7. Emit remaining ancestry in branch segments ordered by head slot. Within a
   segment, use deterministic depth-first postorder traversal with incoming
   context-edge slots defining sibling order.
8. Resolve block selections without following provenance edges.
9. Return warnings for missing token estimators or oversized context. Do not
   silently discard content.
10. Canonically serialize and hash the complete plan.

Shared ancestry among only a subset of three or more heads remains duplicated
inside those branch segments in the initial implementation. A later compiler may
factor such intersections, but it must preserve the same visible meaning and
expose the optimization in the context inspector.

## Output

The provider-neutral `CompiledContext` contains:

- Common transcript segment.
- Ordered labelled branch segments.
- Source node/revision provenance for every item.
- Inclusion decisions and warnings.
- Estimated tokens and estimator identity.
- Compiler version and canonical SHA-256 hash.

It intentionally does not pretend that a branched graph is already a linear
chat-completions message list. Each provider adapter must produce and store a
`SerializedProviderRequest` so the inspector can show the exact request.

## Token policy

The initial compiler only reports budget violations. Users explicitly exclude,
excerpt, or summarize content. Automatic summarization is opt-in future work and
must create visible summary nodes with source provenance and generation
metadata.

## Reproducibility

A generation run stores both compiled context and the adapter-serialized
request, excluding credentials. Retrying an exact run uses those snapshots.
Creating a new run recompiles current graph heads and may intentionally differ.

## Required tests

- Linear histories preserve causal order.
- Shared ancestry is emitted exactly once for a two-way merge.
- Branch order follows explicit slots, not insertion order.
- Reference and provenance edges never enter model context.
- Pinned revisions remain stable after a node is revised.
- Compilation is identical across repeated runs and object insertion orders.
- Missing nodes, invalid revisions, duplicate slots, and cycles fail clearly.
- Budget overflow creates a warning without dropping content.
