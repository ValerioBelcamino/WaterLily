# RFC-007: Text bindings, summary checkpoints, and context metering

Status: accepted and implemented

## Purpose

Long graph conversations need two complementary compression tools. A user must
be able to assemble a prompt from reusable graph content without copying it, and
must be able to replace a long ancestry with an explicit, editable summary root.
Both operations must remain deterministic after saving, sharing, and importing a
graph.

## Text templates

Template syntax is available only in text content blocks. A variable is written
as `{{name}}`, where `name` starts with a letter or underscore and contains at
most 64 ASCII letters, digits, underscores, or hyphens. `\{{name}}` produces the
literal text `{{name}}`; pairs of preceding backslashes remain literal. Titles,
identifiers, metadata, file paths, and code execution settings are never
interpreted as templates.

Resolution is a single pass. Text inserted by a binding is opaque even when it
contains braces, so a value containing `{{another_name}}` cannot trigger an
unexpected second expansion. Unbound variables stop context compilation with a
visible error. Resolved text is limited to 1 MiB per block.

Every binding records:

- the variable name;
- the source node;
- the exact source revision;
- an optional exact source text block.

Binding or unbinding creates a new immutable target revision. Editing a text
block also creates a revision and removes bindings for variables no longer in
the text. A later edit to the source does not silently change an existing
binding: reconnecting it is the explicit way to pin the newer source revision.

Bindings are data dependencies, not conversation ancestry. The canvas projects
them as lilac virtual edges between a node's text output and named input pins;
they are not stored as domain `context`, `provenance`, or `reference` edges.
During context preview and generation, required binding nodes and lines join the
active-flow glow. Compilation substitutes their resolved text into the target
block but does not add a separate provider message for the source.

Graph validation rejects malformed templates, stale block references, duplicate
or irrelevant bindings, and dependency cycles. Import remaps pinned node and
revision identifiers. SQLite, graph JSON, and `.waterlily` archives preserve the
binding structure as ordinary versioned graph data.

## Summary checkpoints

A checkpoint is an editable `summary` node with checkpoint metadata and one
`summarized` provenance edge from every selected source revision. It has no
incoming context edges. Consequently, choosing the checkpoint as a new head
sends the summary itself and does not traverse the full source tree. Provenance
keeps the original material inspectable without putting it back into model
context.

Checkpoint text uses the same template and revision rules as other editable
text. Checkpoints are manual in this version: automatic model-generated summary
workflows are intentionally deferred.

## Context meter

The inspector estimates the exact currently selected and overridden compiled
flow. The provider-neutral preview estimator counts UTF-8 text bytes divided by
four, rounded up, plus a small visible per-message and branch allowance. It is
always labelled approximate. Native attachment payloads are reported separately
and are not presented as tokenized by this estimator.

Model descriptors may advertise a context window and maximum output size. The UI
reserves the smaller of 8,192 tokens and the model's maximum output, displays
the remaining input budget, and blocks generation when the estimate exceeds it.
If a model or local server has no advertised context size, WaterLily still shows
the estimate and clearly labels the limit unknown. The same known input budget
is passed to server-side deterministic context compilation; provider-side limits
remain authoritative.

## Deferred scope

This RFC does not add general expression evaluation, arithmetic or Blender-style
function nodes, templates in non-text fields, an exact provider tokenizer, or
automatic summaries. Those require separate semantics and threat modelling.
