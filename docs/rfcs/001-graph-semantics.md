# RFC-001: Graph semantics and invariants

- Status: Accepted for initial implementation
- Date: 2026-08-05

## Problem

A canvas can show arbitrary lines, but an LLM request requires deterministic,
ordered context. The domain must distinguish visual relationships from causal
relationships and prevent a later edit from rewriting historical generations.

## Model

A workspace contains graph documents. A graph document contains semantic nodes,
causal and non-causal edges, canvas items, and named views. A conversation is a
selected traversal through a graph, not a separately owned list of messages.

### Nodes

Initial semantic node kinds are `message`, `note`, `excerpt`, `summary`, and
`attachment`. Message roles are `system`, `user`, `assistant`, and `tool`.
Groups are canvas items rather than semantic nodes because grouping must not
alter model context.

A node has a stable identity and one or more immutable content revisions. Its
title, tags, color, position, collapsed state, and selection state are not part
of the content revision. A causal edge pins the source revision that it uses.

Editing referenced message content creates a revision or a sibling branch.
Existing causal edges and generation snapshots continue to point at the prior
revision. No operation rewrites completed generation history.

### Edges

Edges point from a contributing source to a dependent target.

| Kind         | Prompt effect                                  | Rule               |
| ------------ | ---------------------------------------------- | ------------------ |
| `context`    | Source revision is eligible for target context | Causal and acyclic |
| `provenance` | None                                           | Causal and acyclic |
| `reference`  | None                                           | May form cycles    |

The union of context and provenance edges is the causal graph and must be a
directed acyclic graph. This stronger rule prevents contradictory histories such
as a node being derived from its own descendant. Self-edges are forbidden for
every edge kind.

Parallel edges with the same kind, source revision, and target are duplicates
and are rejected. Different edge kinds between the same nodes are valid.

Context edges include a non-negative integer `slot`. Incoming context slots for
a target are unique and provide explicit source ordering for merges. Reordering
sources changes slots in a transaction.

## Operations

All multi-entity operations are atomic commands.

- `createNode`: creates a node and its first immutable revision.
- `reviseNode`: creates a new revision without modifying prior revisions.
- `connectContext`: pins a source revision, assigns a slot, and rejects cycles.
- `connectProvenance`: records derivation and rejects causal cycles.
- `connectReference`: adds a non-contextual link.
- `forkFrom`: creates a child node connected to a selected source revision.
- `splitRevision`: creates excerpt nodes with provenance and chosen context.
- `mergeContext`: creates a target with two or more explicitly ordered sources.
- `synthesize`: creates a generated summary with context and provenance inputs.
- `removeNode`: soft-deletes the node and hides incident edges without deleting
  history required by generation snapshots.

## Split semantics

Splitting never removes or mutates the original node. Each excerpt stores:

- Source node and revision identifiers.
- Stable source block identifiers.
- Optional character offsets within boundary blocks.
- Verbatim selected content and its cryptographic hash.

An excerpt can independently become a context parent. By default its incoming
context is copied from the original source, while the original full response is
not included. This lets a user continue from only one section of a long answer.

## Merge semantics

A context merge has at least two incoming context edges with unique slots and
human-visible labels. It does not imply textual concatenation. The context
compiler emits a common segment plus ordered branch segments.

A synthesis merge is a generation whose result becomes a new summary node. It
records provenance from all sources as well as the exact compiled context.

## Invariants to test

1. Node and revision identifiers are unique.
2. Every node owns at least one revision and its current revision exists.
3. Causal edges reference existing source revisions belonging to their sources.
4. Causal edges never create a cycle.
5. All self-edges are rejected.
6. Incoming context slots are unique per target.
7. Duplicate edges are rejected.
8. Failed commands leave the graph byte-for-byte unchanged.
9. Revising content never mutates prior revisions or pinned causal edges.
10. Splits preserve their source and verifiable provenance.

## Deliberate exclusions

Authentication, collaborative conflict resolution, tool execution, automatic
summarization, and semantic retrieval are outside the initial domain model.
