# Engineering journal

This is the durable development log for WaterLily. Read it before starting a
feature and update it only after recording the evidence used to verify that
feature. Failed experiments and plan corrections belong here too.

## Working conventions

- A feature is not complete until its unit, property, integration, or end-to-end
  tests match its risk.
- Provider integration tests are opt-in and must skip cleanly when credentials
  are absent.
- Prompts, full responses, and credentials are never written to normal logs.
- Architecture changes are recorded as RFCs or ADRs before they spread through
  multiple packages.
- Existing generated messages are immutable. Graph operations are recoverable.

## Roadmap status

| Area                       | Status   | Completion evidence                      |
| -------------------------- | -------- | ---------------------------------------- |
| Repository and journal     | Complete | Root checks and formatting pass          |
| RFC-001 graph semantics    | Accepted | Implemented invariants have domain tests |
| RFC-002 context compiler   | Complete | Implemented and verified                 |
| RFC-003 graph format       | Accepted | Plain JSON v1 verified; ZIP deferred     |
| Domain package: core graph | Complete | 30 tests; 100% lines, 99.14% branches    |
| Context engine             | Complete | 19 tests; 100% coverage                  |
| SQLite persistence         | Complete | 32 tests; 99.31% lines, 99.02% branches  |
| API contract               | Complete | 49 tests; 100% coverage                  |
| Local application service  | Complete | 24 tests; 98.30% lines, 94.93% branches  |
| Web graph editor           | Complete | 58 tests; 97.37% lines, 90.02% branches  |
| Provider streaming         | Complete | 46 tests; 98.97% lines, 96.77% branches  |
| Branch/split/merge         | Complete | 30 workflow tests; 100% coverage         |
| Import/export              | Complete | 36 tests; >97% all coverage dimensions   |
| Dropped-file context       | Complete | Unit, compilation, and Chromium E2E pass |
| Active context flow        | Complete | Exact compiler projection and E2E glow   |
| Live DeepSeek verification | Complete | 3 credential-safe V4 Flash calls pass    |
| Public-alpha hardening     | Complete | Full-stack Chromium E2E and CI pass      |

## 2026-08-05 — Bootstrap

### Decisions

- Created a new repository named `waterlily`; the name is a working identifier
  rather than a branding decision.
- Selected Apache-2.0 to minimize friction for downstream applications and
  provider/plugin authors.
- Provider secrets will remain outside tracked files. The supplied DeepSeek
  credential will only be used by opt-in integration tests.
- The first executable feature is the graph domain because canvas and provider
  work both depend on its invariants.

### Observations and plan adjustments

- The host has Node.js 24 but no directly available `pnpm` binary. Use Corepack
  after dependency installation is authorized and verified.
- The repository starts independently from unrelated projects in `/home/belca`.
- Installing every package's newest release initially selected TypeScript 7,
  while the current type-aware ESLint stack accepts TypeScript below 6.1. The
  catalog is therefore pinned to TypeScript 6.0 and Node 24 definitions. A peer
  dependency check confirms the corrected dependency graph is valid.

### Verification performed

- Confirmed the repository did not previously exist.
- Initialized an empty Git repository on the `main` branch.
- Confirmed `.env` and SQLite runtime files are ignored by the planned root
  ignore rules.

## 2026-08-05 — Core graph domain completed

### Implemented

- Pure TypeScript graph snapshots, nodes, immutable revisions, content blocks,
  context edges, provenance edges, and reference edges.
- Functional commands for graph/node creation, content revision, and all three
  edge types. Commands never mutate their input snapshot.
- Pinned source revisions for causal edges, including intentionally selecting an
  older source revision.
- Runtime validation for portable identifiers, canonical timestamps, JSON-safe
  metadata, content blocks, message roles, attachment metadata, entity record
  keys, causal references, duplicate edges, merge slots, and graph versions.
- Cycle detection over the union of context and provenance edges. Reference
  cycles remain legal.

### Defects caught and corrected during verification

- The production build originally removed Node type declarations while using
  `structuredClone`. The build-specific configuration now includes the Node 24
  runtime types; the real build passes.
- The first 21 tests passed but missed adversarial persisted-input branches and
  failed the 95% coverage gate. Nine runtime-corruption tests were added rather
  than weakening the threshold.

### Verification evidence

- `pnpm --filter @waterlily/domain typecheck`: pass.
- `pnpm --filter @waterlily/domain lint`: pass.
- `pnpm --filter @waterlily/domain build`: pass.
- `pnpm --filter @waterlily/domain test:coverage`: 30/30 tests pass; 100%
  statements, lines, and functions; 99.14% branches.
- Property suites run 150 cases each for causal-chain closure, arbitrary
  reference cycles, and revision pin stability.

## 2026-08-05 — Deterministic context compiler completed

### Implemented

- Linear context traversal and deterministic multi-head compilation.
- Shared-ancestry factoring for merges, with branch order determined by explicit
  head slots and internal source order determined by context slots.
- Provider-neutral common and labelled branch segments that retain node,
  revision, role, kind, title, block, and inclusion-decision provenance.
- Node-wide and revision-specific overrides for full, excluded, or selected
  block content. Exact revision overrides take precedence.
- Optional token estimators and token-budget warnings. Overflow never silently
  removes content.
- Canonical JSON serialization and portable Web Crypto SHA-256 hashes.

### Plan correction

The original RFC described `excerpt` and `summary` as compiler inclusion modes.
That would allow invisible content transformation. The compiler now supports
explicit block selection, while excerpts and summaries remain visible graph
nodes with provenance. RFC-002 was updated to match this safer behavior.

### Defects caught and corrected during verification

- The first passing suite reached only 91.15% branch coverage. Reviewing the
  missed paths revealed several defensive branches that were impossible after
  graph validation and paired-head construction. The implementation was
  simplified to encode those guarantees structurally, then a valid two-revision
  comparison case was added to cover deterministic decision ordering.
- Type-aware ESLint's stylistic preference for non-null assertions conflicted
  with its strict rule forbidding those assertions. The contradictory stylistic
  rule is disabled; explicit, justified internal casts remain visible.

### Verification evidence

- `pnpm --filter @waterlily/context-engine typecheck`: pass.
- `pnpm --filter @waterlily/context-engine lint`: pass.
- `pnpm --filter @waterlily/context-engine build`: pass.
- `pnpm --filter @waterlily/context-engine test:coverage`: 19/19 tests pass;
  100% statements, branches, functions, and lines.
- The property suite compiles 100 randomly sized chains up to 60 nodes and
  verifies exact ordering and deduplication.

## 2026-08-05 — SQLite persistence completed

### Implemented

- Stable Drizzle ORM runtime over `better-sqlite3`; the experimental
  `node:sqlite`/Drizzle release-candidate path was deliberately avoided.
- Explicit, checksum-tracked SQL migrations applied one at a time in
  transactions.
- Strict SQLite tables for graphs, nodes, immutable revisions, and typed edges,
  with JSON checks, causal revision ownership, context-slot uniqueness,
  same-graph endpoint foreign keys, and deferred current-revision ownership.
- Atomic graph insertion and replacement, optimistic timestamp conflict
  detection, full semantic round trips, and stored-data validation on reads.
- File databases use WAL, full synchronous durability, foreign keys, a busy
  timeout, and untrusted schema mode. Read-only reopening is supported.

### Supply-chain adjustment

- pnpm correctly blocked `better-sqlite3`'s native install script. Only that
  package was approved and its SQLite runtime was directly verified.
- Drizzle Kit introduced three `esbuild` script versions and deprecated
  transitive packages. It was removed; `esbuild` scripts remain explicitly
  denied. Migration compatibility is tested by applying reviewed SQL to real
  fresh databases instead of depending on the CLI at runtime.

### Defects caught and corrected during verification

- The initial passing suite reached 93.33% branch coverage. Empty graph writes
  had not been exercised and the migrator contained an impossible branch for a
  project-specific error inside raw SQLite execution. An empty round trip was
  added and the dead branch removed.
- Repository read error handling now covers the full read operation: malformed
  stored JSON and invalid graph snapshots become `CORRUPT_DATA`, while genuine
  operational errors remain distinguishable.

### Verification evidence

- `pnpm --filter @waterlily/database typecheck`: pass.
- `pnpm --filter @waterlily/database lint`: pass.
- `pnpm --filter @waterlily/database build`: pass.
- `pnpm --filter @waterlily/database test:coverage`: 21/21 tests pass; 100%
  statements, branches, functions, and lines.
- Fifty property runs persist and reload random Unicode chains of up to 20
  nodes.
- Tests verify idempotent migration, checksum mismatch rejection, migration
  rollback, mid-insert rollback, optimistic conflict safety, read-only reopen,
  foreign-key checking, and SQLite integrity checking.

## 2026-08-05 — Web canvas and focus-mode vertical slice completed

### Implemented

- React 19 and Vite 8 web application using React Flow's permissively licensed
  canvas primitives, with strict TypeScript and React Hooks/Fast Refresh
  linting.
- Custom conversation nodes for system, user, assistant, note, and summary
  content; typed context, provenance, and reference edges have distinct colors,
  line styles, labels, and arrowheads.
- Deterministic left-to-right fallback layout derived from context depth.
  Dragged positions live only in the Zustand presentation store and never enter
  the immutable domain graph.
- Canvas zoom, pan, minimap, controls, node selection, deselection, and an exact
  revision inspector.
- Focus mode reconstructs the selected context thread, factors shared merge
  ancestry once, and excludes provenance/reference edges from model context.
- Responsive application shell, edge legend, reduced-motion behavior, semantic
  landmarks, accessible names, and disabled affordances that accurately label
  future milestones.
- The client has no external font or asset fetches, preserving local-first
  operation. A representative branching/merge graph exercises the vertical slice
  until persistence is wired into the application layer.

### Defects caught and corrected during verification

- Testing Library cleanup was not reliably registered by the initial Vitest
  setup, allowing DOM from earlier tests to leak into later queries. Cleanup is
  now explicit after every component test.
- Redundant runtime branches contradicted already-validated graph invariants and
  obscured the view model. The projection now encodes those invariants in its
  types while retaining safe public fallbacks for missing selections/revisions.
- A stress run that launched normal tests and coverage tests simultaneously
  exposed Vitest's five-second default as too small for the property suites on a
  loaded CI host. All package suites now use a documented 20-second ceiling;
  normal repository concurrency subsequently passed.

### Verification evidence

- `pnpm --filter @waterlily/web test:coverage`: 19/19 tests pass; 100%
  statements, functions, and lines; 98.87% branches.
- Tests cover graph projection, deterministic layout, edge presentation,
  attachment labels, truncation, deleted nodes, shared merge ancestry, canvas
  selection/drag/deselection wiring, minimap categories, focus navigation,
  inspector fallbacks, and presentation-state reset.
- `pnpm check`: all 13 lint, typecheck, build-dependency, and test tasks pass
  across all four packages.
- `pnpm test:coverage`: 89/89 tests pass across the repository with every
  package above its coverage gate.
- `pnpm build`: production web bundle and all library packages build; the web
  bundle is 397.38 kB JavaScript (126.12 kB gzip) and 26.83 kB CSS (5.48 kB
  gzip).
- Browser-level visual regression and end-to-end interaction testing remains a
  public-alpha hardening task; this milestone is verified through real React
  component rendering in jsdom and a production build.

## 2026-08-05 — Provider-neutral streaming completed

### Implemented

- Accepted RFC-004, defining the provider boundary, event lifecycle, retry
  ownership, partial-output semantics, and credential rules.
- Dependency-free `ChatProvider` contract returning structured async stream
  events for response metadata, public reasoning, answer text, usage, and
  terminal finish reason.
- OpenAI-compatible adapter for DeepSeek, Ollama, vLLM, LM Studio, and
  compatible gateways, using platform fetch/streams and injectable fetch
  implementations.
- DeepSeek factory using its current production base URL and usage-enabled SSE;
  model selection remains request data and defaults to `deepseek-v4-flash` only
  in the opt-in live test/example environment.
- Incremental SSE decoder supporting arbitrary byte boundaries, UTF-8 decoding,
  LF/CRLF/lone-CR records, comments/keep-alives, ignored fields, multi-line
  data, final records without a blank separator, and `[DONE]`.
- Request validation, provider-specific JSON options that cannot replace core
  request fields, tool-message serialization, custom paths/headers, optional
  local authentication, cancellation, and all documented finish reasons.
- Typed network, cancellation, HTTP, configuration, request, and protocol
  errors. Provider diagnostics are narrowly parsed, bounded, and credential
  redacted; arbitrary HTML/text error bodies and request prompts are not
  surfaced.
- No automatic retries, preserving explicit cost and provenance decisions for
  the application layer.

### Defects caught and corrected during verification

- Static TypeScript shapes alone would have allowed malformed provider choices
  to cause generic property-access failures. Every streamed choice, delta,
  content field, finish reason, and usage object is now checked at runtime and
  fails as a typed protocol error.
- The SSE state initially used closure-mutated booleans that type-aware linting
  could not prove were mutable. A single explicit stream-state object now makes
  the lifecycle and missing-`[DONE]` check both readable and analyzable.
- A test used an incorrectly hand-calculated Unix timestamp; the asserted UTC
  value was corrected against the runtime conversion.

### Verification evidence

- `pnpm --filter @waterlily/providers test:coverage`: 46/46 deterministic tests
  pass; 98.13% statements, 96.77% branches, 100% functions, and 98.97% lines.
- Protocol fixtures cover one-byte stream boundaries, DeepSeek keep-alives,
  reasoning and usage chunks, all finish-reason mappings, abrupt EOF, missing
  metadata/body, malformed JSON and shapes, invalid usage, request settings,
  custom local endpoints, aborts, network failures, bounded errors, and secret
  redaction.
- `pnpm check`: all 16 repository tasks pass across five packages.
- `pnpm test:coverage`: 135 deterministic tests pass across the repository; the
  one live DeepSeek test skips cleanly because this process has neither an
  installed `DEEPSEEK_API_KEY` nor `RUN_LIVE_PROVIDER_TESTS=1`.
- `pnpm build` and `pnpm format:check`: pass.
- The user-supplied credential was deliberately not copied into a shell command,
  file, log, or test fixture. A live run can be performed from a user-controlled
  environment without changing source.

## 2026-08-05 — Graph workflows and concurrency-safe generation completed

### Implemented

- Application-level branch and ordered multi-head merge commands that create
  user-message nodes and pin every causal source revision.
- Verbatim split excerpts with pinned provenance. Each excerpt inherits the
  source node's ordered incoming context while omitting the unsplit source node,
  so a learner can continue from one section without silently restoring the
  entire answer.
- Provider request serialization from compiled common and labelled branch
  segments, including explicit branch-boundary messages and tool-call metadata.
- A streaming generation coordinator that validates event order, records the
  exact context hash and provider request, and creates an immutable assistant
  node only after a complete terminal event.
- Replayable generation commits that apply to the latest graph instead of
  replacing it with a stale generation snapshot. Concurrent completions can
  therefore coexist while retaining their original pinned inputs.

### Defects caught and corrected during verification

- The initial split implementation made excerpts isolated roots even though
  RFC-001 requires them to retain the source node's prior context. Split now
  copies the source's incoming context edges, requires explicit fresh edge IDs,
  and rejects fabricated or blank excerpt text that is not verbatim content of
  the cited source blocks.
- Provider tool messages originally lacked the revision metadata required for
  exact serialization. Compiled items now retain immutable revision metadata.

### Verification evidence

- `pnpm --filter @waterlily/workflows test:coverage`: 30/30 tests pass; 100%
  statements, branches, functions, and lines.
- Tests cover historical-revision branches, ordered labelled merges, verbatim
  splits from linear and merged histories, invalid split definitions, exact
  request serialization, every stream lifecycle failure, cancellation, and
  concurrent commit application.

## 2026-08-05 — Plain JSON graph interchange completed

### Implemented

- Accepted RFC-003 for canonical plain JSON version 1. The future checksummed
  ZIP attachment container remains explicitly deferred.
- Exact format/version envelopes, runtime validation, an exported JSON Schema,
  deterministic canonical serialization, SHA-256 export hashes, and a default 10
  MiB import limit.
- Presentation positions and named colored groups are portable without entering
  the immutable domain graph.
- Clone and merge imports remap graph entities and group identifiers, preserve
  pinned source revisions, and record source identifiers in revision metadata.
- Import rejects malformed or future documents, invalid graph/view state,
  collisions, credential-shaped object fields, and attachments that require the
  future archive format.

### Verification evidence

- `pnpm --filter @waterlily/interchange test:coverage`: 36/36 tests pass; 98.55%
  statements, 97.60% branches, 100% functions, and 98.50% lines.
- Fixtures cover deterministic round trips, byte limits, canonical timestamps,
  malformed JSON causes, exact keys, graph cycles, positions, groups, secrets,
  attachments, mappings, metadata provenance, and collision rollback.

## 2026-08-05 — Interactive graph editing application completed

### Implemented

- The web client now reads the live graph from the application store and exposes
  working branch, split, ordered merge, context include/exclude, named group,
  JSON import, and checksummed JSON download operations.
- Shift-click creates an ordered multi-selection. Custom group nodes frame their
  children; moving a group updates all member positions while layout remains
  presentation-only.
- Split opens with the exact source revision text, uses explicit `---`
  boundaries, and creates independently selectable excerpt nodes with visible
  provenance and inherited ancestry.
- Import failures remain inside an accessible modal, identifiers are remapped
  before merge, and secrets never cross the browser/provider boundary.

### Plan adjustments

- Adding new workspace packages caused one formatting command to trigger a
  registry lookup in the restricted environment. The attempt was stopped and
  workspace links were refreshed with `pnpm install --offline`; no new package
  was required for workflows or interchange.
- Built-in React Flow groups do not render durable human-visible titles. A
  custom group node now supplies the label and member count while retaining
  React Flow parent/child movement semantics.

### Verification evidence

- `pnpm --filter @waterlily/web test:coverage`: 40/40 tests pass; 96.49%
  statements, 91.01% branches, 96.57% functions, and 96.23% lines.
- Component and state tests exercise branch, split, merge, group movement,
  additive selection, context exclusion, canonical export/download cleanup,
  valid and rejected imports, focus navigation, modal validation, and reset.
- `pnpm check`: all 26 lint, typecheck, build-dependency, and test tasks pass
  across seven packages.
- `pnpm test:coverage`: 222 deterministic tests pass; the opt-in live provider
  test skips cleanly without credentials. Every package exceeds its configured
  coverage threshold.
- `pnpm build`: all packages and the production web bundle build. The web bundle
  is 422.63 kB JavaScript (133.96 kB gzip) and 30.57 kB CSS (6.28 kB gzip).
- `pnpm format:check`: pass.

## 2026-08-05 — Local application service and public-alpha hardening completed

### Implemented

- Accepted RFC-005 for a loopback-only Node application service, server-side
  provider secrets, atomic workspace persistence, optimistic writes, NDJSON
  generation transport, and conflict-only commit retries.
- Added a strict shared API contract for versioned workspace state, provider
  descriptors, generation requests, streamed provider events, terminal commits,
  and sanitized terminal errors.
- Extended SQLite with a second reviewed migration and a workspace repository
  that persists graph and presentation state in nested transactions. Runtime
  state must be finite, acyclic, plain JSON and is validated again on reads.
- Added health, workspace GET/PUT, and generation endpoints through a
  fetch-compatible handler plus a Node HTTP adapter. The boundary enforces
  same-origin requests, 10 MiB bodies, valid UTF-8, restrictive response
  headers, cancellation, and bounded errors without logging content or
  credentials.
- Registered DeepSeek and configurable OpenAI-compatible local providers from
  service-only environment variables. Blank values fall back safely and a custom
  DeepSeek base URL is supported.
- Connected the React client to service health, hydration, optimistic debounced
  autosave, model selection, exact context overrides, streamed public reasoning
  and answer text, cancellation, and committed workspace replacement.
- Added Chromium end-to-end infrastructure with an isolated temporary SQLite
  database and a deterministic mock OpenAI-compatible SSE provider. CI now
  checks formatting, strict types, lint, deterministic tests, package coverage,
  the production build, and the full-stack browser path.
- Updated public setup, architecture, privacy, security, support, contribution,
  issue, pull-request, and dependency-update documentation.

### Defects caught and corrected during verification

- The first autosave implementation scheduled an unnecessary second write after
  creating a missing workspace. Hydration now consumes one explicit skip marker
  for both loaded and newly created workspaces.
- TypeScript could not preserve a nested streamed-event discriminant inside
  React state callbacks. Capturing the immutable provider event before the
  callbacks now makes the narrowing exact.
- The first real Chromium run found that storing `window.fetch` on a class and
  calling it as a method supplied the wrong receiver, causing an
  `Illegal invocation` that Node and jsdom did not reproduce. The client binds
  fetch to the global object and has a focused regression test.
- The initial browser assertion selected an SVG edge label rather than the
  semantic conversation article. The test now targets accessible roles, which
  also verifies the intended interaction surface.
- Web branch coverage briefly fell below its 90% gate after adding composed
  service states. App-level online/offline/streaming cases and service failure
  cases were added instead of weakening the threshold.

### Verification evidence

- `pnpm check`: 34/34 tasks pass across nine packages; 324 deterministic tests
  pass and the one opt-in live DeepSeek test skips without credentials.
- `pnpm test:coverage`: all 16 coverage/build tasks pass. New package results
  are API contract 49 tests at 100%; database 32 tests at 98.71% statements and
  99.02% branches; server 24 tests at 97.36% statements and 94.93% branches; web
  58 tests at 96.57% statements and 90.02% branches.
- `pnpm exec playwright test --reporter=line`: the Chromium full-stack test
  passes in 3.9 seconds. It exercises browser fetch, Vite proxying, service
  validation, deterministic SSE reasoning/text, generation commit, SQLite
  autosave, branching, reload, and context-selection persistence.
- `pnpm install --frozen-lockfile --offline`: pass for all ten workspace
  projects, proving the committed lockfile is coherent with the workspace.
- `pnpm audit --audit-level high`: no known vulnerabilities.
- `pnpm format:check` and `pnpm build`: pass after the final documentation and
  lockfile update.
- Credential-pattern scan finds no key, private key, or non-empty DeepSeek
  environment assignment. `.env` and SQLite paths are confirmed ignored.
- All nine packages build; the production web output is 436.22 kB JavaScript
  (137.82 kB gzip) and 32.27 kB CSS (6.58 kB gzip).
- The user-supplied key was never copied into a command, file, log, fixture, or
  provider request. No paid network request was made.

## 2026-08-05 — WaterLily rebrand completed

### Implemented

- Renamed package scopes, application-service identifiers, client and store
  modules, environment variables, interchange identifiers, browser tests, and
  visible product copy to WaterLily.
- Replaced the generic branch icon in the product mark with a flower mark while
  preserving the graph-focused interface language.
- Kept the legacy graph-format migration intentionally out of scope because no
  released WaterLily documents exist yet.

### Verification evidence

- `pnpm install --offline`: all ten workspace projects resolve after the scope
  changes and the lockfile remains coherent.
- `pnpm check`: all 34 lint, strict-type, build-dependency, and deterministic
  test tasks pass; 324 tests pass and the opt-in live test skips by default.
- Case-insensitive tracked-source scan finds no former product name, package
  scope, repository slug, or legacy internal identifier.
- The local `.env` is ignored, has mode `600`, and contains a non-empty
  credential variable; its value was not printed or staged.

## 2026-08-05 — Dropped-file context completed

### Implemented

- The canvas accepts one to eight dropped text or source files, reads them only
  in the browser, creates visible attachment-kind nodes containing plain text,
  and connects them to the selected node through ordered context edges.
- File metadata records the name, media type, byte size, last-modified value,
  and explicit drop source. Presentation positions remain outside the immutable
  graph, while file text remains portable, persistent model context.
- Dropping with no selection creates standalone context nodes. Unsupported,
  empty, binary-looking, unreadable, oversized, or excessive batches fail
  atomically with bounded user-facing errors. The initial limit is 2 MiB per
  file and eight files per drop; PDF/binary extraction remains deferred.

### Defects caught and corrected during verification

- TypeScript did not retain a context-edge discriminant across a separate
  filter/map chain. Slot collection now uses a discriminating `flatMap`, making
  the narrowed type and fallback behavior explicit.
- The first focused suite passed all behavior tests but reduced total web branch
  coverage below its 90% gate. Nested drag depth, non-file drags, standalone
  multi-file drops, all validation failures, and both byte-order-mark paths were
  tested; the gate was preserved.

### Verification evidence

- `pnpm --filter @waterlily/web typecheck` and `lint`: pass.
- Web unit/component suite: 72 tests pass. It covers file classification,
  Unicode/BOM handling, read failures, limits, atomic state changes, exact
  metadata, ordered slots, standalone nodes, drop geometry, overlays, and safe
  errors.
- `pnpm --filter @waterlily/web test:coverage`: pass at 97.03% statements,
  90.03% branches, 97.22% functions, and 97.74% lines.
- A real context-engine compilation from the new file edges contains both
  dropped text blocks in their explicit slot order.
- Production build passes. Chromium full-stack E2E passes and verifies browser
  file transfer, visible node creation, context-edge persistence through the
  loopback service and SQLite, generation, branching, and reload.

## 2026-08-05 — Active generation flow completed

### Implemented

- Every generation now compiles the captured graph snapshot and context
  overrides before persistence, then exposes the exact included node set and
  connecting context edges only for that request's lifetime.
- Active nodes and edges receive a green pulse and glow inspired by Unreal's
  execution graph; unrelated nodes and every non-context path fade. Semantic
  `data-flow-state` values and an `active context` footer preserve inspectable
  meaning beyond color.
- The flow begins during the pre-generation save, remains visible throughout
  streaming, and clears after success, provider failure, or cancellation.
  Reduced-motion preferences collapse every pulse to a single near-instant
  iteration.

### Plan correction

- A first App-level jsdom assertion expected React Flow nodes to render without
  browser geometry. React Flow intentionally withheld those nodes in that
  environment, so projection remains covered at the component boundary while the
  actual App wiring, DOM state, animation, fading, and cleanup are verified in
  Chromium.
- Root E2E lint initially lacked DOM library types, and replacing the typed
  Playwright callback with a string expression silently returned a function
  instead of dispatching file events. The root test project now declares DOM
  types, retains Node types, and uses the original browser callback; root lint,
  strict type checking, and the full Chromium path all pass together.

### Verification evidence

- `pnpm --filter @waterlily/web typecheck` and `lint`: pass.
- Web suite: 74 tests pass. Exact compiler-derived node and edge sets are tested
  with an excluded intermediate node; projections cover active, inactive, and
  idle states; the service test observes the flow during a pending request and
  verifies cancellation cleanup.
- `pnpm --filter @waterlily/web test:coverage`: pass at 97.12% statements,
  90.15% branches, 97.32% functions, and 97.82% lines.
- Production build passes. Chromium full-stack E2E asserts that the selected
  synthesis and newly dropped file are active, an unrelated note fades to 0.32
  opacity, the node pulse animation is applied, active edges exist during the
  delayed SSE response, and all flow state returns to idle after commit.

## 2026-08-05 — Live DeepSeek verification completed

### Implemented

- Added an explicit billable live command that loads the ignored root `.env`
  only inside child Node processes. Normal deterministic tests do not load it
  and continue to skip live tests cleanly.
- Expanded the provider test to cover V4 Flash non-thinking and thinking modes,
  response metadata, public-reasoning deltas, answer deltas, terminal events,
  and internally consistent usage accounting.
- Added a full application-service live test covering provider registration,
  health discovery, context compilation, real SSE decoding, provider-neutral
  events, NDJSON transport, generation commit, persisted graph growth, assistant
  content, model/provider/usage provenance, and credential absence from every
  serialized artifact.

### Plan correction

- The first service attempt made no paid request because its health assertion
  expected only DeepSeek, while the service correctly also advertises an
  unavailable local-provider slot. The exact two-descriptor contract is now
  asserted, after which only the service live test was rerun.

### Verification evidence

- Official DeepSeek documentation confirms that `deepseek-v4-flash` is the
  current low-cost model, uses `https://api.deepseek.com`, supports both modes,
  toggles them with `thinking.type`, and streams reasoning separately from final
  answer content.
- `pnpm --filter @waterlily/providers test:live`: 2/2 live tests pass in 2.72
  seconds using explicit disabled and enabled thinking modes.
- `pnpm --filter @waterlily/server test:live`: 1/1 live test passes in 5.45
  seconds through the complete application-service path.
- Three small paid requests completed. No test printed a prompt, full response,
  or credential; boolean scans confirm the credential is absent from provider
  events, generation stream items, committed metadata, and persisted workspace.
- `.env` remains ignored with mode `600`; it is absent from Git's index.

## 2026-08-17 — Context previews, native files, provider profiles, and Python cells

### Implemented

- A selected graph head now previews its exact compiler-derived context in blue.
  Shift-selected heads preview an ordered multi-head flow, while an in-flight
  request temporarily replaces the preview with the green pulsing execution
  flow. Excluded nodes and non-context paths remain visibly inactive.
- File drops now upload opaque bytes to a permission-restricted local store and
  put only checksummed attachment descriptors in the graph. The OpenAI Responses
  adapter sends images as native image inputs and other supported files as
  native file inputs. Model capability descriptors drive red incompatibility
  states and block a request before transmission when an unsupported file is
  included.
- The loopback service now manages several named OpenAI, DeepSeek, and generic
  OpenAI-compatible profiles. Credentials are atomically persisted outside the
  repository with `0700` directory and `0600` file permissions; browser health
  responses contain only non-secret descriptors. Provider and model selection
  are explicit toolbar state.
- Python code and execution are first-class graph node kinds. Running a cell
  compiles its selected context, replays included code cells in order through a
  fresh isolated-mode interpreter, and commits bounded stdout/stderr and status
  as a connected execution node. Per-graph working directories persist files;
  the child environment is allowlisted and excludes provider credentials.
- Workspace persistence validation was separated from portable-export
  validation. Local workspaces accept attachment references, while JSON v1
  continues to reject them until a checksummed archive format exists.

### Security and product boundaries

- Native attachments are limited to eight files per drop and 10 MiB per file.
  Stored blobs are integrity-checked on read and are loaded only at the OpenAI
  provider boundary for an included compatible flow.
- Stored credentials are plaintext under OS filesystem protection, not browser
  local storage and not encrypted at rest. An OS keychain backend remains a
  future hardening option.
- The Python runner is an offline notebook-like convenience, not a sandbox. It
  uses no shell, applies a 10-second limit and a 256 KiB combined-output limit,
  but code retains the user's filesystem and network authority. The UI and
  security documentation state this before execution.
- Codex subscription authentication remains deliberately deferred; no browser
  session, OAuth token, or unofficial subscription mechanism was added.

### Defects caught and corrected during verification

- The first attachment browser run revealed that API workspace validation reused
  the portable JSON validator and rejected attachment blocks. A reusable
  view-state validator now preserves strict local validation without weakening
  the export prohibition.
- The same browser path exposed a delayed autosave racing a generation commit.
  Autosave timers now pause for the complete saving/streaming lifecycle, and the
  end-to-end test asserts that no optimistic-conflict warning appears.
- The live service test reached a stale exact health fixture after provider
  descriptors gained models and capabilities. It now asserts the actual
  server-side public descriptors and separately checks that the credential is
  absent.

### Verification evidence

- `pnpm check`: all 34 tasks pass. Across nine packages, 427 deterministic tests
  pass; the three explicitly billable tests skip in normal runs.
- `pnpm test:coverage`: all 16 tasks and every configured threshold pass. The
  API contract and context engine are at 100%; providers are 97.81% statements
  and 96.33% branches; server is 97.94% and 96.61%; web is 97.21% and 90.28%.
- `pnpm test:e2e`: Chromium passes the complete drop, incompatible-model block,
  exclusion, running-flow animation, streamed commit, branch, autosave, reload,
  and restored-selection path.
- The ignored `.env` live path completed 2/2 provider lifecycle tests and 1/1
  full application-service test against DeepSeek. Three small requests were
  made; the key was neither printed nor present in serialized provider events,
  generation metadata, health responses, or persisted workspaces.
- `pnpm build`, `pnpm format:check`, `git diff --check`, and the ignored-file
  audit pass. `.env` remains untracked with mode `600`.

## 2026-08-17 — Portable `.waterlily` workspaces

### Implemented

- Added the accepted `waterlily/archive` v1 ZIP format and `.waterlily` file
  extension. A single download preserves the full immutable graph, canvas
  positions, groups, context selections, and every attachment byte while
  recursively rejecting credential-shaped metadata.
- Archive readers enforce exact manifests, canonical paths, SHA-256 and byte
  lengths, graph/view/context invariants, attachment-reference equality, and
  compressed, expanded, entry, count, and per-file limits. Unsafe, duplicate,
  missing, and unexpected ZIP entries fail before a workspace is returned.
- The local service can integrity-check/download and delete attachments. Browser
  import restores bytes under new local IDs, rewrites attachment blocks, remaps
  graph/group/context-selection IDs, persists one merged workspace, and performs
  compensating blob deletion after an upload or save failure.
- Export and import are now first-class toolbar operations. Legacy
  attachment-free graph JSON remains available through the import dialog; the
  primary export is a portable archive.
- Documented the current host-Python threat model, a WebAssembly Safe Python
  design, and a consumer desktop release plan based on a sandboxed Electron UI,
  typed privilege boundary, OS keychain, signed installers, and packaged-app
  tests.

### Defects caught and corrected during verification

- The first Chromium export called a captured class method without its receiver,
  so the private fetch client was unavailable. Attachment client methods are now
  explicitly bound before asynchronous use, and the browser completes the real
  download/import round trip.
- Playwright stores downloads under a temporary filename without the original
  extension. The E2E now re-uploads the exact downloaded bytes with the
  suggested `.waterlily` filename, matching what an actual file picker supplies.
- The initial archive tests passed behavior but missed the repository's 95%
  interchange coverage gate. Corrupt primitive fields, canonical timestamps and
  paths, conflicting/duplicate attachments, duplicate central-directory paths,
  UTF-8 failures, and every resource-limit class were added without lowering the
  gate.

### Verification evidence

- `pnpm check`: all 34 tasks pass; 450 deterministic tests pass across the nine
  workspaces and the three explicitly billable tests remain skipped by default.
- `pnpm test:coverage`: every package gate passes. Interchange reaches 99.55%
  statements, 98.63% branches, 100% functions, and 99.53% lines; web reaches
  96.96%, 90%, 97.41%, and 97.77% respectively.
- `pnpm test:e2e`: Chromium uploads an attachment, persists and reloads the
  workspace, downloads `graph-bioenergetics.waterlily`, imports those exact
  bytes, restores the file, and observes a collision-safe merge from 10 to 20
  nodes.
- Production build, strict type checking, lint, formatting, and ZIP integrity
  checks pass. No live provider request was needed because provider transport
  and credentials were not changed.

## 2026-08-17 — Installable desktop alpha

### Implemented

- Added an Electron 43 shell and Forge packaging workspace. The sandboxed,
  context-isolated BrowserWindow loads the production client from a private
  `waterlily://app` origin with no preload or Node integration. Static assets
  and the application API share a containment-checked protocol router, so the
  installed service opens no HTTP listener.
- Extracted the complete local service into a reusable lifecycle factory. The
  desktop app stores SQLite, attachments, credentials, and optional code
  workspaces under Electron's per-user data directory and bundles every database
  migration into the main-process build.
- Denied permissions, webviews, new windows, and foreign navigation; added a
  restrictive CSP and same-origin resource headers; burned current Electron
  fuses to disable Node mode, Node options/inspection, file-protocol privileges,
  and non-ASAR application loading.
- Disabled trusted host Python in desktop packages by default. An explicit
  `WATERLILY_DESKTOP_ENABLE_HOST_PYTHON=1` remains available for advanced users
  who accept the documented host-access boundary.
- Added an original WaterLily/graph application mark in PNG, multi-resolution
  ICO, and ICNS formats. Forge now creates a branded Debian package, Windows
  Squirrel artifacts, and macOS DMG/ZIP targets.
- Added a lockfile-derived production staging step that removes workspace
  symlinks and development sources. A GitHub matrix packages and smoke-tests
  Linux x64, Windows x64, and macOS arm64, retains artifacts for seven days, and
  creates only a draft release for unsigned `v*` tags.

### Defects caught and corrected during verification

- Forge 7 still names a Git-pinned Electron `node-gyp` fork that pnpm 11 blocks
  as an undeclared exotic subdependency. The identical published version is
  narrowly overridden instead of disabling pnpm's supply-chain protection.
- Directly packaging a pnpm monorepo made Forge crawl workspace symlinks and
  fail on native transitive modules. The maker now consumes pnpm's portable,
  dedicated-lockfile deploy output with exact production versions.
- Enabling the browser-specific V8 snapshot fuse without shipping Electron's
  optional snapshot made the first executable abort before startup. The fuse is
  deliberately off; the other hardening fuses remain strict and the real
  packaged binary boots.
- The first Debian maker inferred the scoped workspace name as its executable.
  Explicit package, binary, product, section, launcher, and icon metadata now
  produce a valid `waterlily` installation.
- Vitest initially discovered the Playwright packaged-app specification and a
  generated staging copy. The unit suite is now explicitly scoped to
  `test/**/*.test.ts`, and the deploy manifest ships only assets, production
  output, and Forge configuration.

### Verification evidence

- `pnpm check`: all 39 lint, typecheck, build-prerequisite, and deterministic
  test tasks pass across ten workspaces.
- `pnpm test:coverage`: all 19 tasks pass. The desktop protocol router reaches
  97.14% statements, 89.47% branches, 100% functions, and 96.96% lines without
  lowering any existing package gate.
- `pnpm build`: all ten production builds pass; the Electron main bundle is
  121.8 kB before its renderer and runtime are packaged.
- The packaged Playwright test launches the fused production executable,
  verifies `waterlily://app/`, the sample graph and health API, absent Node
  globals, private SQLite creation and permissions, and default rejection of
  host Python.
- Forge produces `waterlily_0.1.0_amd64.deb` (108,394,264 bytes). `dpkg-deb`
  verifies its dependencies, application launcher, desktop entry, icon, ASAR,
  and native SQLite payload; its local SHA-256 is
  `fa2f4816cd0eeec8dda912c59f55551f6e0fda9bcf3816c4d87877768188dce6`.
- The cross-platform workflow is syntax-checked locally. Windows/macOS maker
  execution remains to be verified by its first GitHub-hosted matrix run.
