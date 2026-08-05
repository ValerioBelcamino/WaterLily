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
- Stream answer text and provider-exposed public reasoning from DeepSeek or an
  OpenAI-compatible local server, with cancellation and visible failures.
- Persist graph, context selections, positions, and groups atomically in local
  SQLite with optimistic conflict detection.
- Import another graph with collision-safe identifier remapping and export
  canonical, checksummed JSON.

## Quick start

Requirements are Node.js 24 or newer and Corepack. Clone the repository, then:

```sh
corepack pnpm install --frozen-lockfile
cp .env.example .env
corepack pnpm build
```

Edit `.env` and set either `DEEPSEEK_API_KEY` or a
`LOCAL_LLM_BASE_URL`/`LOCAL_LLM_MODEL` pair. Credentials are read only by the
loopback service; they are never sent to browser JavaScript or graph exports.

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
| `packages/interchange`    | Canonical JSON v1, schema, import, clone, merge, export    |
| `packages/providers`      | Provider-neutral streaming and OpenAI-compatible adapter   |
| `packages/database`       | Reviewed SQLite migrations and repositories                |
| `packages/api-contract`   | Strict browser/service request and stream validation       |
| `apps/server`             | Loopback persistence and provider boundary                 |
| `apps/web`                | Canvas, focus view, operations, autosave, and streaming UI |

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
```

Package coverage gates are enforced in CI. Provider tests are deterministic by
default. A real DeepSeek request runs only when both `DEEPSEEK_API_KEY` and
`RUN_LIVE_PROVIDER_TESTS=1` are present; a live request may incur cost.

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
- Plain JSON v1 rejects attachment bytes until the checksummed archive extension
  is specified.
- Imported graphs merge into the active workspace. A multi-document workspace
  browser and graph renaming flow are still planned.
- Browser visual-regression coverage and packaged desktop distribution remain
  public-alpha work.

## Contributing

Issues and pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md),
the accepted RFCs, and the engineering journal before changing graph semantics
or a persistence/protocol boundary. The project is licensed under
[Apache-2.0](LICENSE).
