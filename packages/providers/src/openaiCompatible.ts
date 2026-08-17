import { ProviderError } from './errors.js';
import { ServerSentEventDecoder } from './sse.js';
import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  FetchImplementation,
  FinishReason,
  JsonValue,
  StreamChatOptions,
} from './types.js';

const RESERVED_BODY_KEYS = new Set([
  'max_tokens',
  'messages',
  'model',
  'stop',
  'stream',
  'stream_options',
  'temperature',
  'top_p',
]);

type ApiKeySource = string | (() => string | undefined);

export interface OpenAICompatibleProviderConfig {
  readonly apiKey?: ApiKeySource;
  readonly baseUrl: string;
  readonly fetch?: FetchImplementation;
  readonly headers?: Readonly<Record<string, string>>;
  readonly id: string;
  readonly includeUsage?: boolean;
  readonly name: string;
  readonly requestPath?: string;
}

export interface DeepSeekProviderConfig {
  readonly apiKey: ApiKeySource;
  readonly baseUrl?: string;
  readonly fetch?: FetchImplementation;
}

interface OpenAIChunk {
  readonly choices: readonly {
    readonly delta: {
      readonly content?: string | null;
      readonly reasoning_content?: string | null;
    };
    readonly finish_reason?: string | null;
  }[];
  readonly created?: number;
  readonly id?: string;
  readonly model?: string;
  readonly usage?: {
    readonly completion_tokens: number;
    readonly prompt_tokens: number;
    readonly total_tokens: number;
  } | null;
}

function configurationError(providerId: string, message: string): never {
  throw new ProviderError('CONFIGURATION_ERROR', message, { providerId });
}

function assertProviderConfig(config: OpenAICompatibleProviderConfig): URL {
  if (config.id.trim().length === 0 || config.name.trim().length === 0) {
    configurationError(config.id, 'Provider id and name cannot be blank');
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(
      config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`,
    );
  } catch (cause) {
    throw new ProviderError(
      'CONFIGURATION_ERROR',
      'Provider base URL is invalid',
      {
        cause,
        providerId: config.id,
      },
    );
  }
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0
  ) {
    configurationError(
      config.id,
      'Provider base URL must be HTTP(S) without credentials, query, or fragment',
    );
  }
  for (const header of Object.keys(config.headers ?? {})) {
    if (header.toLowerCase() === 'authorization') {
      configurationError(
        config.id,
        'Use apiKey instead of an Authorization header',
      );
    }
  }
  return baseUrl;
}

function assertRequest(providerId: string, request: ChatRequest): void {
  if (request.model.trim().length === 0 || request.messages.length === 0) {
    throw new ProviderError(
      'INVALID_REQUEST',
      'A non-blank model and at least one message are required',
      { providerId },
    );
  }
  if (
    request.maxOutputTokens !== undefined &&
    (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0)
  ) {
    throw new ProviderError(
      'INVALID_REQUEST',
      'maxOutputTokens must be a positive integer',
      { providerId },
    );
  }
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 2)
  ) {
    throw new ProviderError(
      'INVALID_REQUEST',
      'temperature must be between 0 and 2',
      {
        providerId,
      },
    );
  }
  if (
    request.topP !== undefined &&
    (!Number.isFinite(request.topP) || request.topP < 0 || request.topP > 1)
  ) {
    throw new ProviderError('INVALID_REQUEST', 'topP must be between 0 and 1', {
      providerId,
    });
  }
  for (const key of Object.keys(request.providerOptions ?? {})) {
    if (RESERVED_BODY_KEYS.has(key)) {
      throw new ProviderError(
        'INVALID_REQUEST',
        `providerOptions cannot override reserved field ${key}`,
        { providerId },
      );
    }
  }
}

function messageBody(
  providerId: string,
  message: ChatMessage,
): Record<string, JsonValue> {
  if (typeof message.content !== 'string') {
    throw new ProviderError(
      'INVALID_REQUEST',
      'This OpenAI-compatible chat endpoint does not support native file inputs',
      { providerId },
    );
  }
  const body: Record<string, JsonValue> = {
    content: message.content,
    role: message.role,
  };
  if (message.name !== undefined) body.name = message.name;
  if (message.role === 'tool') body.tool_call_id = message.toolCallId;
  return body;
}

function requestBody(
  providerId: string,
  request: ChatRequest,
  includeUsage: boolean,
): Record<string, JsonValue> {
  const body: Record<string, JsonValue> = {
    ...request.providerOptions,
    messages: request.messages.map((message) =>
      messageBody(providerId, message),
    ),
    model: request.model,
    stream: true,
  };
  if (includeUsage) body.stream_options = { include_usage: true };
  if (request.maxOutputTokens !== undefined)
    body.max_tokens = request.maxOutputTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.stop !== undefined) body.stop = request.stop;
  return body;
}

function resolveApiKey(source: ApiKeySource | undefined): string | undefined {
  const value = typeof source === 'function' ? source() : source;
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function property(value: object, key: string): unknown {
  return (value as Readonly<Record<string, unknown>>)[key];
}

function providerMessage(value: unknown, apiKey: string | undefined): string {
  if (typeof value !== 'object' || value === null)
    return 'No diagnostic message';
  const error = property(value, 'error');
  if (typeof error !== 'object' || error === null)
    return 'No diagnostic message';
  const message = property(error, 'message');
  if (typeof message !== 'string') return 'No diagnostic message';
  const bounded = message.slice(0, 512);
  return apiKey === undefined
    ? bounded
    : bounded.replaceAll(apiKey, '[REDACTED]');
}

async function httpError(
  providerId: string,
  response: Response,
  apiKey: string | undefined,
): Promise<never> {
  let diagnostic = 'No diagnostic message';
  try {
    diagnostic = providerMessage(JSON.parse(await response.text()), apiKey);
  } catch {
    // Provider bodies are intentionally not surfaced unless they match the
    // narrow JSON error shape above.
  }
  throw new ProviderError(
    'HTTP_ERROR',
    `Provider request failed with HTTP ${String(response.status)}: ${diagnostic}`,
    { providerId, status: response.status },
  );
}

function protocolError(
  providerId: string,
  message: string,
  cause?: unknown,
): never {
  throw new ProviderError('PROTOCOL_ERROR', message, {
    ...(cause === undefined ? {} : { cause }),
    providerId,
  });
}

function parseChunk(providerId: string, data: string): OpenAIChunk {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch (cause) {
    protocolError(
      providerId,
      'Provider emitted malformed JSON in its stream',
      cause,
    );
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray(property(value, 'choices'))
  ) {
    protocolError(
      providerId,
      'Provider emitted an invalid chat completion chunk',
    );
  }
  const choices = property(value, 'choices') as unknown[];
  for (const choice of choices) {
    if (typeof choice !== 'object' || choice === null) {
      protocolError(
        providerId,
        'Provider emitted an invalid completion choice',
      );
    }
    const delta = property(choice, 'delta');
    if (typeof delta !== 'object' || delta === null) {
      protocolError(
        providerId,
        'Provider emitted a completion choice without a delta',
      );
    }
    for (const field of ['content', 'reasoning_content'] as const) {
      const deltaValue = property(delta, field);
      if (
        deltaValue !== undefined &&
        deltaValue !== null &&
        typeof deltaValue !== 'string'
      ) {
        protocolError(providerId, `Provider emitted invalid ${field}`);
      }
    }
    const rawFinishReason = property(choice, 'finish_reason');
    if (
      rawFinishReason !== undefined &&
      rawFinishReason !== null &&
      typeof rawFinishReason !== 'string'
    ) {
      protocolError(providerId, 'Provider emitted an invalid finish reason');
    }
  }
  return value as unknown as OpenAIChunk;
}

function finishReason(raw: string | null): FinishReason {
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content-filter';
    case 'tool_calls':
      return 'tool-calls';
    default:
      return 'other';
  }
}

function timestamp(seconds: number | undefined): string | null {
  return seconds === undefined || !Number.isFinite(seconds)
    ? null
    : new Date(seconds * 1_000).toISOString();
}

function usageEvent(
  providerId: string,
  usage: OpenAIChunk['usage'],
): ChatStreamEvent | null {
  if (usage === undefined || usage === null) return null;
  if (
    !Number.isInteger(usage.prompt_tokens) ||
    !Number.isInteger(usage.completion_tokens) ||
    !Number.isInteger(usage.total_tokens) ||
    usage.prompt_tokens < 0 ||
    usage.completion_tokens < 0 ||
    usage.total_tokens < 0
  ) {
    protocolError(providerId, 'Provider emitted invalid token usage');
  }
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    type: 'usage',
  };
}

async function* streamResponse(
  providerId: string,
  response: Response,
): AsyncIterable<ChatStreamEvent> {
  if (response.body === null) {
    protocolError(
      providerId,
      'Provider returned a streaming response without a body',
    );
  }
  const reader = response.body.getReader();
  const textDecoder = new TextDecoder();
  const sse = new ServerSentEventDecoder();
  const streamState = { doneMarker: false, ended: false, started: false };

  const emit = function* (data: string): Iterable<ChatStreamEvent> {
    if (data === '[DONE]') {
      if (!streamState.started) {
        protocolError(
          providerId,
          'Provider ended before emitting response metadata',
        );
      }
      streamState.doneMarker = true;
      if (!streamState.ended) {
        streamState.ended = true;
        yield {
          finishReason: 'other',
          rawFinishReason: null,
          type: 'response-end',
        };
      }
      return;
    }
    const chunk = parseChunk(providerId, data);
    if (!streamState.started) {
      if (typeof chunk.id !== 'string' || typeof chunk.model !== 'string') {
        protocolError(
          providerId,
          'The first provider chunk omitted response metadata',
        );
      }
      streamState.started = true;
      yield {
        createdAt: timestamp(chunk.created),
        model: chunk.model,
        responseId: chunk.id,
        type: 'response-start',
      };
    }

    const choice = chunk.choices[0];
    if (choice !== undefined) {
      const reasoning = choice.delta.reasoning_content;
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        yield { delta: reasoning, type: 'reasoning-delta' };
      }
      const content = choice.delta.content;
      if (typeof content === 'string' && content.length > 0) {
        yield { delta: content, type: 'text-delta' };
      }
    }
    const usage = usageEvent(providerId, chunk.usage);
    if (usage !== null) yield usage;

    const rawFinishReason = choice?.finish_reason ?? null;
    if (rawFinishReason !== null && !streamState.ended) {
      streamState.ended = true;
      yield {
        finishReason: finishReason(rawFinishReason),
        rawFinishReason,
        type: 'response-end',
      };
    }
  };

  try {
    let reading = true;
    while (reading) {
      const result = await reader.read();
      if (result.done) {
        reading = false;
      } else {
        for (const data of sse.push(
          textDecoder.decode(result.value, { stream: true }),
        )) {
          yield* emit(data);
        }
      }
    }
    for (const data of sse.push(textDecoder.decode())) yield* emit(data);
    for (const data of sse.finish()) yield* emit(data);
  } finally {
    reader.releaseLock();
  }

  if (!streamState.doneMarker) {
    protocolError(providerId, 'Provider stream ended before its [DONE] marker');
  }
}

class OpenAICompatibleProvider implements ChatProvider {
  readonly id: string;
  readonly name: string;
  readonly #apiKey: ApiKeySource | undefined;
  readonly #baseUrl: URL;
  readonly #fetch: FetchImplementation;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #includeUsage: boolean;
  readonly #requestPath: string;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.#baseUrl = assertProviderConfig(config);
    this.#apiKey = config.apiKey;
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#headers = config.headers ?? {};
    this.#includeUsage = config.includeUsage ?? false;
    this.#requestPath = config.requestPath ?? 'chat/completions';
  }

  async *streamChat(
    request: ChatRequest,
    options: StreamChatOptions = {},
  ): AsyncIterable<ChatStreamEvent> {
    assertRequest(this.id, request);
    const apiKey = resolveApiKey(this.#apiKey);
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...this.#headers,
    };
    if (apiKey !== undefined) headers.Authorization = `Bearer ${apiKey}`;

    let response: Response;
    try {
      response = await this.#fetch(new URL(this.#requestPath, this.#baseUrl), {
        body: JSON.stringify(requestBody(this.id, request, this.#includeUsage)),
        headers,
        method: 'POST',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (cause) {
      const canceled =
        options.signal?.aborted === true ||
        (cause instanceof DOMException && cause.name === 'AbortError');
      throw new ProviderError(
        canceled ? 'CANCELED' : 'NETWORK_ERROR',
        canceled
          ? 'Provider request was canceled'
          : 'Provider network request failed',
        { cause, providerId: this.id },
      );
    }

    if (!response.ok) await httpError(this.id, response, apiKey);
    yield* streamResponse(this.id, response);
  }
}

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleProviderConfig,
): ChatProvider {
  return new OpenAICompatibleProvider(config);
}

export function createDeepSeekProvider(
  config: DeepSeekProviderConfig,
): ChatProvider {
  return createOpenAICompatibleProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? 'https://api.deepseek.com',
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    id: 'deepseek',
    includeUsage: true,
    name: 'DeepSeek',
  });
}
