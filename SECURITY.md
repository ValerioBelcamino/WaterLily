# Security policy

## Supported versions

The project is an early public alpha with no supported release line yet.
Security fixes are made on the `main` branch until tagged releases begin.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose credentials,
conversation data, local files, or remote code execution. Use GitHub private
vulnerability reporting when it is available for the repository. Otherwise,
contact the repository owner privately and include reproduction steps, affected
versions or commits, expected impact, and any known mitigation.

Please do not access data that is not yours, degrade a third-party service, or
publish details before a fix can be prepared. Maintainers should acknowledge a
complete report promptly and coordinate disclosure based on severity.

## Trust boundaries

- The Node service listens on `127.0.0.1` by default and has no user
  authentication. Exposing it on a LAN or the internet requires a separately
  designed authenticated TLS boundary.
- Provider credentials exist only in the service process environment or a local
  credential file. The default file is outside the repository under the user's
  data directory and is written atomically with `0600` permissions in a `0700`
  directory. It is not encrypted at rest and relies on OS-account and filesystem
  protection. Credentials must never be serialized into graph data, returned to
  the browser, included in URLs, or written to normal logs.
- Prompts, model responses, notes, imports, SQLite files, and exports are
  sensitive user data. SQLite is not encrypted at rest by this application.
- Native attachment blobs are stored with user-only permissions and are sent
  only when they are included in a compiled flow and the selected model
  advertises compatible native-file support.
- Imported JSON is untrusted, strictly validated, and size-limited. Plain JSON
  v1 rejects attachments; future archives and plugins require separate threat
  models.
- Provider diagnostics are bounded and sanitized. The service does not log
  request bodies or streamed content.
- The local Python runner is not a sandbox. It strips provider credentials from
  the child environment and applies time/output limits, but executed code keeps
  the user's filesystem and network authority. Treat untrusted or
  model-generated code as arbitrary code execution.

## Credential hygiene

Use `.env` only on a trusted machine and keep its existing Git ignore rule. A
credential pasted into a chat, issue, screenshot, or terminal transcript should
be considered exposed and rotated. Live provider tests are opt-in and can incur
cost.
