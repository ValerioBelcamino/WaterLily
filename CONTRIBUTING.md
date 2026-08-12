# Contributing

Thank you for helping make long-form model conversations more inspectable and
reusable. Small, focused pull requests are easiest to review; larger changes are
welcome after the design is discussed in an issue or RFC.

Please follow the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Report security
problems privately as described in [`SECURITY.md`](SECURITY.md), not in a public
issue.

## Development setup

Requirements:

- Node.js 24 or newer
- Corepack
- a C/C++ toolchain if a prebuilt `better-sqlite3` binary is unavailable for
  your platform

Install and verify:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm check
corepack pnpm test:coverage
corepack pnpm build
```

Copy `.env.example` to `.env` only if you need a local provider run. Never
commit credentials or real conversation data. Normal tests do not require a
network connection or provider key.

## Change workflow

1. Read the engineering journal and relevant RFCs.
2. Add or update tests that exercise success, invalid input, concurrency, and
   cancellation paths proportional to the change's risk.
3. Keep package dependencies pointed inward; domain code must stay independent
   of UI, database, and provider implementations.
4. Run the four verification commands above.
5. Update documentation and the engineering journal with measured evidence.

Do not weaken coverage thresholds to land a feature. Generated messages are
immutable, graph changes must remain recoverable, context transformations must
be visible, and provider calls are never retried invisibly.

## Design changes

Changes to graph semantics, context compilation, interchange, provider
contracts, service trust boundaries, plugin permissions, or persistent storage
require an RFC or architecture decision record before the design spreads across
packages. Copy an existing file in `docs/rfcs` and include context, decision,
consequences, and migration/compatibility impact.

## Commits and pull requests

- Explain the user problem and the invariant being protected.
- Keep generated files and unrelated formatting out of the change.
- Link the issue or RFC when applicable.
- Include verification output and call out any intentionally deferred work.
- By contributing, you agree that your contribution is licensed under Apache-2.0
  and certify that you have the right to submit it. Signed-off commits
  (`git commit -s`) are encouraged.
