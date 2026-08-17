# Desktop distribution

## Product outcome

A non-technical user should download one signed installer, launch WaterLily from
the normal applications menu, choose a local model or API provider, and begin
working without Node.js, pnpm, or SQLite. Conversation data stays in the user's
application-data directory when the application is upgraded or removed.

The packaging foundation is implemented. The generated alpha installers are not
yet a public one-click release because Windows signing and macOS
signing/notarization credentials have not been configured.

## Implemented shell

Electron is the pragmatic first shell because WaterLily is a React + Node
TypeScript application with a native `better-sqlite3` dependency. Electron Forge
packages the application for each operating system.

```text
WaterLily Electron application
├── sandboxed BrowserWindow
│   └── packaged React UI at waterlily://app/
├── private protocol router
│   ├── static assets + restrictive CSP
│   └── /api/* Fetch requests
└── embedded local service (no listening socket)
    ├── SQLite + bundled migrations
    ├── attachments + provider profiles
    ├── model-provider clients
    └── trusted host Python (disabled in desktop by default)
```

The renderer has Chromium sandboxing and context isolation enabled, Node
integration off, no preload bridge, and no Electron APIs. The main process
denies permission requests, new windows, webviews, and navigation away from the
private origin. Static paths are containment-checked, and a content security
policy permits only packaged scripts and same-origin API traffic. The custom
protocol routes `Request`/`Response` objects directly to the application
handler; the installed app does not expose a loopback HTTP port.

Package-time fuses disable `ELECTRON_RUN_AS_NODE`, Node inspector arguments,
`NODE_OPTIONS`, and the extra privileges normally associated with `file://`. The
app loads only its ASAR, with embedded integrity validation enabled on platforms
that support it. A separate browser-process V8 snapshot fuse remains off because
Electron does not ship the required `browser_v8_context_snapshot.bin` in its
standard distribution.

This boundary limits renderer authority, but it is not a sandbox for arbitrary
Python. The packaged app disables host Python unless
`WATERLILY_DESKTOP_ENABLE_HOST_PYTHON=1` is explicitly set. Safe offline Python
still requires the WebAssembly worker described in
[`sandboxing.md`](sandboxing.md).

## Data and credentials

Electron's per-user `userData` directory contains a `data` folder with the
database, attachments, Python workspaces, and permission-restricted provider
profile file. Typical parent directories are:

- Linux: `~/.config/WaterLily`
- macOS: `~/Library/Application Support/WaterLily`
- Windows: `%APPDATA%\WaterLily`

Provider keys entered in the UI cross the renderer/service boundary once, then
are stored with user-only file permissions. Stored keys are never returned by
the API or included in `.waterlily` files. They are not yet encrypted at rest;
Keychain, Credential Manager, and Secret Service backends remain a release gate.
Development `.env` files are ignored and never copied into the staging directory
or installer.

## Build and test locally

From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm make:desktop
corepack pnpm test:desktop
```

`make:desktop` builds every workspace, creates an isolated production staging
tree from the lockfile, packages the current platform, rebuilds/checks the
native dependency, flips fuses, and runs the platform maker. Artifacts are
written below `apps/desktop/.package/out/make`:

- Linux x64: Debian `.deb`
- Windows x64: Squirrel `Setup.exe`, `.nupkg`, and release metadata
- macOS arm64: `.dmg` and `.zip`

The packaged Playwright smoke test starts the actual executable through a
temporary loopback Chrome debugging endpoint. It verifies the private origin,
initial graph, health API, absent Node globals, SQLite startup, and data
permissions. The production Node-inspector fuse stays disabled during this test.

## GitHub workflow and cost

The `Desktop packages` workflow can be started with **Run workflow** in GitHub
Actions. Relevant changes on `main` also run it automatically. Three standard
hosted runners build and smoke-test platform artifacts, which remain
downloadable for seven days. Pushing a `v*` tag creates an **unsigned draft**
GitHub Release containing all artifacts. A maintainer must inspect and
sign/notarize them before publishing.

The repository is public, so standard GitHub-hosted runner minutes are free.
Artifact and package storage still count against the account's storage
allowance; larger runners are not used. Keeping artifacts for seven days limits
that footprint.

## Remaining public-release gates

- Sign Windows installers; sign and notarize both Apple Silicon and Intel macOS
  applications. Add an Intel macOS build if that platform remains supported.
- Store provider profiles in each operating system's keychain.
- Implement Safe Python and a visible trusted-code opt-in instead of relying on
  an environment variable.
- Register `.waterlily` file associations and OS open/import handling.
- Add a first-run provider/local-model connection flow.
- Test upgrade, rollback, uninstall, old-database migration, offline restart,
  and archive round trips on clean virtual machines.
- Publish SHA-256 checksum files and third-party license attribution beside
  installers.
- Add staged automatic updates only after rollback and database
  backward-compatibility policies are established.

Electron's official references are the
[distribution overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview),
[Forge packaging guide](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging),
and
[security checklist](https://www.electronjs.org/docs/latest/tutorial/security).
