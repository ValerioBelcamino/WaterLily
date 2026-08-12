# RFC-004: Provider-neutral streaming

- Status: Accepted
- Date: 2026-08-05

## Context

The workbench must run against paid hosted APIs and local inference servers
without letting any provider SDK define the graph model. Streaming is also a
durability boundary: partial output must be observable without pretending it is
a completed immutable graph revision.

DeepSeek's current Chat Completions API and common local servers expose an
OpenAI-compatible `POST /chat/completions` endpoint. DeepSeek streams data-only
SSE records, terminates with `data: [DONE]`, may send `: keep-alive` comments,
and can emit a final usage-only chunk. These behaviors are treated as protocol
requirements rather than provider-specific UI behavior.

Primary references:

- <https://api-docs.deepseek.com/api/create-chat-completion>
- <https://api-docs.deepseek.com/quick_start/rate_limit>
- <https://docs.ollama.com/openai>

## Decision

### Stable interface

`ChatProvider.streamChat()` accepts provider-neutral messages and generation
settings and returns an `AsyncIterable<ChatStreamEvent>`. Events distinguish:

- response metadata;
- public reasoning deltas, when a provider exposes them;
- answer text deltas;
- usage accounting; and
- a terminal finish reason.

Provider errors are typed. They expose status and bounded, sanitized diagnostic
text but never request messages, authorization headers, or raw credentials.

### OpenAI-compatible adapter

The initial adapter uses the platform `fetch`, `ReadableStream`, `TextDecoder`,
and `AbortSignal`; it adds no runtime SDK dependency. Configuration contains the
base URL, provider identity, optional API-key resolver, optional non-secret
headers, and injectable `fetch` for deterministic tests.

The SSE decoder must support arbitrary byte boundaries, CRLF or LF separators,
multi-line `data` fields, comments, final records without a trailing blank line,
and `[DONE]`. Malformed JSON, invalid chunk shapes, missing response bodies, and
unexpected stream termination fail closed with protocol errors.

### Completion and persistence

Streamed deltas remain ephemeral application state. Only after a terminal event
will the application layer create an immutable assistant node revision. An abort
or provider failure may later be offered as an explicitly marked partial draft;
it is never silently committed as a complete response.

### Retry policy

The adapter never retries automatically. A retry can cost money or create a
different answer, so it must be an explicit higher-level operation with its own
new provenance.

### Credentials

Credentials are supplied at runtime and are never written to graph exports,
normal logs, test snapshots, URLs, or tracked configuration. Integration tests
are opt-in and skip when their environment variable is absent.

## Consequences

- DeepSeek, Ollama, vLLM, LM Studio, and compatible gateways share one adapter.
- Provider-specific capabilities can be added without changing graph or context
  packages.
- Tool calls and richer multimodal message content are future event/message
  extensions and require protocol fixtures before activation.
- The application service, not the provider adapter, owns graph mutation and
  concurrent generation orchestration.
