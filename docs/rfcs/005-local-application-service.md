# RFC-005: Local application service

- Status: Accepted
- Date: 2026-08-05

## Context

The graph editor needs durable local state and access to hosted or local model
providers. Sending provider credentials to the browser would expose them to the
client runtime, while direct browser persistence would make atomic graph and
view-state updates difficult. Generation must also commit against the latest
workspace without losing concurrent branches.

## Decision

### Process and trust boundary

The initial application service is a small Node.js process bound to `127.0.0.1`
by default. It owns SQLite and provider credentials. The web client uses
same-origin `/api` requests through the Vite development proxy. Requests with a
conflicting `Origin` are rejected, response headers use a restrictive security
policy, and normal errors and logs never include prompts, responses, provider
diagnostics, or secrets.

Remote or multi-user deployment is outside this RFC. Anyone changing the bind
address must place an authenticated, TLS-terminating boundary in front of the
service.

### Workspace persistence

A versioned workspace contains the immutable domain graph plus explicit context
selections, canvas positions, and groups. SQLite writes graph and workspace
state in one nested transaction. Replacements require the caller's last known
graph timestamp, producing a typed conflict instead of silently overwriting a
newer state.

The browser hydrates once, creates a missing workspace, and then autosaves
debounced snapshots through an ordered promise queue. A failed background save
does not discard the in-memory graph and remains visible to the user.

### Generation transport and commit

`POST /api/generations` accepts graph identifiers, ordered context heads,
explicit context overrides, a registered provider identifier, and
provider-neutral settings. The server loads the persisted graph, compiles and
serializes the exact request, and streams newline-delimited JSON events. Stream
items contain provider events, one committed workspace, or one sanitized error.

Provider streams are never retried automatically. Once a terminal provider event
is received, the server applies the replayable generation commit to the latest
workspace. Only optimistic database conflicts are retried, with a fixed
three-attempt ceiling, because this does not repeat a billable provider call.
Disconnecting the response aborts the upstream provider request.

### API boundary

The `@llm-graph/api-contract` package defines transport types and strict runtime
parsers shared by the service and browser. JSON request bodies are capped at 10
MiB. Unknown routes, methods, keys, versions, malformed UTF-8, and invalid graph
or view state fail closed.

## Consequences

- Provider keys remain server-side and graph exports remain credential-free.
- The fetch-compatible handler can be tested without opening a network socket.
- SQLite remains the only durable dependency for the initial local application.
- The service currently handles one trusted local user; authentication,
  encryption at rest, remote synchronization, and collaboration require new
  threat models and RFCs.
- Plain JSON v1 does not persist attachment bytes. The archive extension from
  RFC-003 remains deferred.
