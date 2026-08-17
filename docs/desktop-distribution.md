# Desktop distribution plan

## Product outcome

A non-technical user should download one signed installer, launch WaterLily from
their normal applications menu, choose either a local model or an API provider,
and begin working. They should not install Node.js, pnpm, Python, SQLite, or use
a terminal. Uninstalling the app should not silently delete their conversations;
data export and removal must be explicit.

## Recommended first shell: Electron

Electron is the pragmatic first release because WaterLily is already a React +
Node TypeScript application and depends on the native `better-sqlite3` module.
It embeds Chromium and Node into a cross-platform application, so user machines
do not need a separate runtime. Electron's official guidance recommends Electron
Forge for packaging, installers, and publishing:
[distribution overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)
and
[Forge packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging).

The cost is a larger download and memory footprint. Tauri can be reconsidered
after the product stabilizes, but today it would require a Rust service rewrite
or a carefully managed Node sidecar while retaining the same database, provider,
and code-kernel security work. Smaller binaries do not justify that migration
risk yet.

## Target architecture

```text
signed WaterLily application
├── sandboxed UI renderer (packaged React assets, no Node integration)
├── narrow typed IPC/preload boundary
├── local service process (SQLite, providers, attachments, OS keychain)
└── isolated Safe Python WebAssembly worker
```

The renderer must load only packaged content, keep Electron's process sandbox
and context isolation enabled, deny navigation/new windows by default, and never
receive raw API keys. Electron's
[security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
requires these boundaries. The service should move from a public loopback HTTP
surface to a typed IPC transport, or use a per-launch authenticated loopback
channel during migration.

Runtime data belongs in the operating system's per-user application-data
directory, not beside the executable. Provider secrets should move from the
current permission-restricted JSON file to Keychain on macOS, Credential Manager
on Windows, and Secret Service on Linux, with an explicit fallback only when no
keychain is available.

## Release sequence

1. Add `apps/desktop` with a minimal Electron main process and a narrow typed
   preload bridge; keep `apps/web` usable for contributors.
2. Bundle the production web build and service. Rebuild/package `better-sqlite3`
   for Electron's ABI and exercise migrations on clean and existing user-data
   directories.
3. Implement Safe Python as described in `docs/sandboxing.md`; keep host Python
   off by default so Python is not a user prerequisite.
4. Add a first-run wizard: data location, local-model detection, provider
   selection, credential entry, a connection test, and an explicit privacy
   summary.
5. Register `.waterlily` file association and support open/import from the OS.
6. Build installers in separate GitHub Actions jobs for Windows x64/arm64, macOS
   x64/arm64, and Linux x64. Each job runs unit, integration, archive,
   migration, and packaged-app Playwright smoke tests.
7. Sign Windows installers; sign and notarize macOS applications. Unsigned
   builds produce frightening or blocking OS warnings, so public "one click"
   releases should not skip this. Electron's
   [distribution documentation](https://www.electronjs.org/docs/latest/tutorial/distribution-overview#code-signing)
   treats signing as part of delivery.
8. Publish installers and checksums to GitHub Releases. Add staged automatic
   updates only after rollback and database backward-compatibility policies are
   tested. Electron documents an updater path for public GitHub projects in its
   [publishing guide](https://www.electronjs.org/docs/latest/tutorial/tutorial-publishing-updating).

## Release gates

- A fresh machine reaches a usable graph without a terminal or external runtime.
- App startup, archive open/save, provider setup, local-model setup, offline
  restart, database migration, update, rollback, and uninstall are tested.
- The packaged renderer has sandboxing and context isolation on, Node
  integration off, a restrictive CSP, no remote code, and validated IPC
  senders/arguments.
- Credentials never enter renderer memory, logs, crash reports, archives, or
  update metadata.
- Safe Python cannot read host files, access the network/service, or survive its
  external time/memory/output limits.
- Installers are signed, release checksums are published, and third-party
  licenses are included.

## Current status

The portable file format and browser/service boundaries needed by a desktop app
now exist, but `apps/desktop`, safe WebAssembly execution, keychain storage,
installers, signing, and update infrastructure are not implemented. Until those
gates land, source-based local development remains the supported alpha path.
