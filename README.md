# WaterLily

WaterLily is a local-first, provider-neutral conversation IDE. It turns a long
chat into an explicit directed graph: branch for a side question, split an
answer into reusable excerpts, merge several lines of reasoning, and inspect
exactly which revisions will be sent to a model.

The repository is an early public alpha. The core graph, deterministic context
compiler, SQLite service, streaming provider boundary, graph operations, and
interactive React canvas are implemented and tested. Product naming and some UI
details can still change; the versioned graph semantics are governed by the
accepted RFCs.

## What works

- Move, inspect, multi-select, and group nodes on a React Flow canvas, or read a
  selected conversation in focus mode.
- Branch from an immutable revision, make verbatim provenance-linked excerpts,
  and merge ordered context heads without flattening their history.
- Include or exclude nodes from future model context explicitly.
- Edit user, system, note, and summary text as immutable revisions. Text blocks
  can expose escaped `{{variable}}` input pins connected to exact graph
  revisions; their lilac dependency lines join the active-flow glow.
- Turn any selection into a persistent, editable summary checkpoint. Its source
  revisions remain provenance-linked while new branches start from the compact
  summary instead of replaying the complete ancestry.
- Inspect an approximate per-node token meter for the selected flow. Known model
  windows reserve output capacity and prevent an oversized request; unknown
  local-model limits are labelled instead of guessed.
- Click a graph head to preview its compiled context path, or Shift-click
  several heads to preview an ordered multi-branch flow. Active lines glow blue;
  a running generation pulses green while unrelated paths fade.
- Drop up to eight supported documents, images, or source files onto the canvas
  as native attachments (10 MiB each). Incompatible files and paths turn red for
  models that cannot receive them and generation explains how to proceed.
- Stream answer text and provider-exposed public reasoning from OpenAI
  Responses, DeepSeek, or an OpenAI-compatible local server, with cancellation
  and visible failures.
- Add Python cells to any branch and replay the included cells through that node
  in a fresh local process. Stdout, stderr, exit status, timeouts, and
  truncation are captured in a new execution node.
- Store several local provider profiles, then choose a provider, model, and key
  from the workspace toolbar. Secrets never enter browser state.
- Persist graph, context selections, positions, and groups atomically in local
  SQLite with optimistic conflict detection.
- Save or share a complete conversation as one checksummed `.waterlily` file.
  The portable archive includes the graph, layout, groups, context choices, and
  attachment bytes, but never provider credentials. Imports validate every file
  before merging and remap all local identifiers.
- Import legacy attachment-free graph JSON with collision-safe identifier
  remapping.

## Quick start

Requirements are Node.js 24 or newer and Corepack. Clone the repository, then:

```sh
corepack pnpm install --frozen-lockfile
cp .env.example .env
corepack pnpm build
```

You can configure `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, or a
`LOCAL_LLM_BASE_URL`/`LOCAL_LLM_MODEL` pair in `.env`. Alternatively, start the
app and use the key button in the toolbar to add several profiles. Credentials
are read only by the loopback service; they are never sent back to browser
JavaScript or graph exports.

Start the service and web client in separate terminals:

```sh
corepack pnpm start:server
```

```sh
corepack pnpm dev:web
```

Open <http://127.0.0.1:4173>. Vite proxies `/api` to the service at
`http://127.0.0.1:4317`. Runtime data is created at `.data/waterlily.sqlite` by
default and is ignored by Git.

For an OpenAI-compatible local server, a typical configuration is:

```dotenv
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_LLM_MODEL=your-installed-model
```

The local adapter is intended for servers such as Ollama, vLLM, and LM Studio.
No API key is required unless that server expects one.

Stored profiles use a versioned JSON file at
`$XDG_DATA_HOME/waterlily/credentials.json` (normally
`~/.local/share/waterlily/credentials.json`) with user-only directory/file
permissions (`0700`/`0600`). This is deliberately outside the repository and is
never exposed through the health API. It is protected by your operating-system
account but is not encrypted at rest; an OS keychain backend is future work.

Native attachment bytes are kept beside the local database in
`.data/attachments` by default. OpenAI Responses profiles can receive supported
files directly. DeepSeek and generic OpenAI-compatible profiles currently
advertise no native-file capability, so WaterLily marks those paths as
incompatible instead of silently flattening or dropping data.

## Local Python cells

Select a node, choose **Code**, and add a Python cell. Running a cell compiles
its context path, replays every included Python cell in order in one fresh
`python3 -I -u` process, and commits the result as a connected execution node.
Each graph gets a persistent working directory under `.data/python`, so cells
can exchange ordinary files across runs even though Python variables are
recreated.

This runner is intentionally local and offline, but it is **not a security
sandbox**. Code has the same filesystem and network permissions as your user.
Only run code you trust and inspect model-generated code before executing it.
Runs stop after 10 seconds and capture at most 256 KiB of combined output. For a
threat-model explanation and the proposed safe execution modes, read
[`docs/sandboxing.md`](docs/sandboxing.md).

## Portable conversations

Choose **Export** to download `<graph-id>.waterlily`. This is the resumable and
shareable format: it contains the complete workspace plus every referenced
attachment. On import, WaterLily verifies ZIP paths, byte limits, canonical
metadata, and SHA-256 checksums before changing the graph. Attachment bytes are
restored under new local IDs, graph IDs are collision-safely remapped, and the
imported workspace is merged into the active graph.

The older `waterlily/graph` JSON remains useful for inspection and integrations,
but it deliberately cannot contain attachment references or context-selection
state. Neither format includes API keys. The archive contract is specified in
[RFC-006](docs/rfcs/006-waterlily-archive.md).

## Templates and context checkpoints

Edit an eligible text node and write `{{topic}}` to create an input pin. Drag a
node's right-side text output onto that pin, or choose its source in the
inspector. The binding pins the source's current immutable revision. Reconnect
it after editing the source when you intentionally want the newer version. Write
`\{{topic}}` when the braces should remain literal. Inserted values are never
interpreted again, and non-text fields are never templated.

Select one or more useful heads and choose **Checkpoint** to create a compact
context root. The summary remains editable and is stored in SQLite and portable
`.waterlily` archives like every other graph revision. The inspector's context
meter follows the exact active heads and include/exclude choices. Its text count
is approximate; native files are listed separately because provider-side file
tokenization is not available locally. The full contract is in
[RFC-007](docs/rfcs/007-templates-checkpoints-context-meter.md).

## Desktop releases

WaterLily now builds as a normal desktop application. Electron, the production
React client, SQLite, migrations, and the local service are bundled; users do
not install Node.js, pnpm, or SQLite. Application data is stored in Electron's
per-user app-data directory, not beside the executable, and no API key or `.env`
file is included in a package.

Build and smoke-test the application for your current platform:

```sh
corepack pnpm make:desktop
corepack pnpm test:desktop
```

Linux produces `waterlily_0.1.0_amd64.deb`; Windows produces a Squirrel Setup
executable and NuGet package; macOS produces a DMG and ZIP. Generated files live
under `apps/desktop/.package/out` and are ignored by Git.

The **Desktop packages** GitHub workflow builds all three platforms on demand. A
`v*` tag also creates a draft release. The draft is deliberately not published
automatically: Windows and macOS packages are unsigned until signing
certificates and repository secrets are configured, so those operating systems
will warn or block ordinary users. The exact commands, trust boundaries, and
remaining release gates are in
[`docs/desktop-distribution.md`](docs/desktop-distribution.md).

## Architecture

The domain and context rules do not depend on React, SQLite, or a provider SDK.
The dependency direction is deliberately one-way:

```text
web ──► api-contract ◄── local service ──► providers
 │             │                │
 ├──► workflows ──► context-engine ──► domain
 └──► interchange ────────────────► domain
                               service ──► database ──► domain
```

| Workspace                 | Responsibility                                             |
| ------------------------- | ---------------------------------------------------------- |
| `packages/domain`         | Immutable graph, revisions, typed edges, invariants        |
| `packages/context-engine` | Deterministic multi-head context compilation and hashes    |
| `packages/workflows`      | Branch, split, merge, generation, and replayable commits   |
| `packages/interchange`    | JSON v1 and `.waterlily` archive validation and remapping  |
| `packages/providers`      | Provider-neutral streaming, Responses, compatible adapters |
| `packages/database`       | Reviewed SQLite migrations and repositories                |
| `packages/api-contract`   | Strict browser/service request and stream validation       |
| `apps/server`             | Loopback persistence and provider boundary                 |
| `apps/web`                | Canvas, focus view, operations, autosave, and streaming UI |
| `apps/desktop`            | Sandboxed Electron shell and cross-platform installers     |

Design decisions live in [`docs/rfcs`](docs/rfcs), and verified implementation
history lives in the [`engineering journal`](docs/engineering-journal.md).

## Verification

```sh
corepack pnpm format:check
corepack pnpm check
corepack pnpm test:coverage
corepack pnpm build
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
corepack pnpm make:desktop
corepack pnpm test:desktop
# Optional and billable; loads the ignored root .env file.
corepack pnpm test:live:deepseek
```

Package coverage gates are enforced in CI. Provider tests are deterministic by
default. A real DeepSeek request runs only when both `DEEPSEEK_API_KEY` and
`RUN_LIVE_PROVIDER_TESTS=1` are present. The live command checks non-thinking
and thinking adapter streams plus a complete application-service generation; it
makes three small requests and may incur cost.

## Security and privacy

- Keep the service bound to loopback. Binding it to another interface does not
  add authentication or TLS.
- Treat graph files as sensitive: they can contain complete prompts and model
  responses even though credential-shaped fields are rejected.
- Do not commit `.env`, SQLite, exported conversation, or provider response
  files.
- Rotate any credential pasted into a chat, issue, terminal transcript, or log.

See [`SECURITY.md`](SECURITY.md) for reporting guidance and trust-boundary
details.

## Current limitations

- This is a single-user local application; authentication, remote sync, and
  real-time collaboration are not implemented.
- Archive attachment restoration uses a compensating transaction: invalid
  imports never alter the graph and failed saves trigger attachment deletion,
  but a process or power failure at the exact point between upload and commit
  can leave an unreferenced local blob for future cleanup.
- Python execution is host-local rather than security-sandboxed. JavaScript,
  shell, and richer notebook display outputs are not implemented yet.
- Generic OpenAI-compatible model capability discovery is not standardized;
  those profiles currently default to no native-file support.
- Imported graphs merge into the active workspace. A multi-document workspace
  browser and graph renaming flow are still planned.
- Browser visual-regression coverage, a safe WebAssembly code runner, signed
  desktop releases, OS-keychain credentials, and automatic updates remain
  public-alpha work. Trusted host Python is disabled by default in desktop
  packages; set `WATERLILY_DESKTOP_ENABLE_HOST_PYTHON=1` only when you accept
  the host-access warning in [`docs/sandboxing.md`](docs/sandboxing.md).

## Contributing

Issues and pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md),
the accepted RFCs, and the engineering journal before changing graph semantics
or a persistence/protocol boundary. The project is licensed under
[Apache-2.0](LICENSE).
