import { Buffer } from 'node:buffer';

import { ProviderError } from './errors.js';
import { ServerSentEventDecoder } from './sse.js';
import type {
  AttachmentLoader,
  ChatContentPart,
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  FetchImplementation,
  JsonValue,
  StreamChatOptions,
} from './types.js';

type ApiKeySource = string | (() => string | undefined);

export interface OpenAIResponsesProviderConfig {
  readonly apiKey: ApiKeySource;
  readonly attachmentLoader: AttachmentLoader;
  readonly baseUrl?: string;
  readonly fetch?: FetchImplementation;
  readonly id: string;
  readonly name: string;
}

const RESERVED_BODY_KEYS = new Set(['input', 'model', 'stream']);

function property(value: object, key: string): unknown {
  return (value as Readonly<Record<string, unknown>>)[key];
}

function providerError(
  providerId: string,
  code: ConstructorParameters<typeof ProviderError>[0],
  message: string,
  options: { readonly cause?: unknown; readonly status?: number } = {},
): ProviderError {
  return new ProviderError(code, message, { providerId, ...options });
}

function resolveApiKey(source: ApiKeySource): string {
  const value = typeof source === 'function' ? source() : source;
  if (value === undefined || value.trim().length === 0)
    throw providerError(
      'openai',
      'CONFIGURATION_ERROR',
      'The OpenAI API key is not configured',
    );
  return value;
}

function validatedBaseUrl(providerId: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value.endsWith('/') ? value : `${value}/`);
  } catch (cause) {
    throw providerError(
      providerId,
      'CONFIGURATION_ERROR',
      'The OpenAI base URL is invalid',
      { cause },
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  )
    throw providerError(
      providerId,
      'CONFIGURATION_ERROR',
      'The OpenAI base URL must be HTTP(S) without embedded credentials',
    );
  return url;
}

function validateRequest(providerId: string, request: ChatRequest): void {
  if (request.model.trim().length === 0 || request.messages.length === 0)
    throw providerError(
      providerId,
      'INVALID_REQUEST',
      'A non-blank model and at least one message are required',
    );
  if (request.stop !== undefined)
    throw providerError(
      providerId,
      'INVALID_REQUEST',
      'The Responses adapter does not support stop sequences',
    );
  for (const key of Object.keys(request.providerOptions ?? {})) {
    if (RESERVED_BODY_KEYS.has(key))
      throw providerError(
        providerId,
        'INVALID_REQUEST',
        `providerOptions cannot override reserved field ${key}`,
      );
  }
}

async function inputPart(
  providerId: string,
  loader: AttachmentLoader,
  part: ChatContentPart,
): Promise<Record<string, JsonValue>> {
  if (part.type === 'text') return { text: part.text, type: 'input_text' };
  let attachment;
  try {
    attachment = await loader(part.attachmentId);
  } catch (cause) {
    throw providerError(
      providerId,
      'INVALID_REQUEST',
      `Attachment ${part.attachmentId} is unavailable`,
      { cause },
    );
  }
  if (
    attachment.mediaType !== part.mediaType ||
    (part.name !== null && attachment.name !== part.name)
  )
    throw providerError(
      providerId,
      'INVALID_REQUEST',
      `Attachment ${part.attachmentId} metadata does not match local storage`,
    );
  const data = `data:${attachment.mediaType};base64,${Buffer.from(attachment.bytes).toString('base64')}`;
  return attachment.mediaType.startsWith('image/')
    ? { detail: 'auto', image_url: data, type: 'input_image' }
    : {
        file_data: data,
        filename: attachment.name,
        type: 'input_file',
      };
}

async function inputMessage(
  providerId: string,
  loader: AttachmentLoader,
  message: ChatMessage,
): Promise<Record<string, JsonValue>> {
  if (message.role === 'tool')
    throw providerError(
      providerId,
      'INVALID_REQUEST',
      'Tool messages are not supported by this Responses adapter yet',
    );
  const rawParts =
    typeof message.content === 'string'
      ? ([{ text: message.content, type: 'text' }] as const)
      : message.content;
  const content = await Promise.all(
    rawParts.map((part) => inputPart(providerId, loader, part)),
  );
  if (message.name !== undefined)
    content.unshift({
      text: `[${message.name}]`,
      type: 'input_text',
    });
  return { content, role: message.role };
}

async function requestBody(
  providerId: string,
  loader: AttachmentLoader,
  request: ChatRequest,
): Promise<Record<string, JsonValue>> {
  const input = await Promise.all(
    request.messages.map((message) =>
      inputMessage(providerId, loader, message),
    ),
  );
  return {
    ...request.providerOptions,
    input,
    model: request.model,
    stream: true,
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: request.maxOutputTokens }),
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
  };
}

function parseData(providerId: string, data: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch (cause) {
    throw providerError(
      providerId,
      'PROTOCOL_ERROR',
      'OpenAI emitted malformed JSON in its response stream',
      { cause },
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw providerError(
      providerId,
      'PROTOCOL_ERROR',
      'OpenAI emitted an invalid response event',
    );
  return value as Record<string, unknown>;
}

function responseObject(
  providerId: string,
  event: Record<string, unknown>,
): Record<string, unknown> {
  const response = event.response;
  if (
    typeof response !== 'object' ||
    response === null ||
    Array.isArray(response)
  )
    throw providerError(
      providerId,
      'PROTOCOL_ERROR',
      'OpenAI response event omitted response metadata',
    );
  return response as Record<string, unknown>;
}

function responseStart(
  providerId: string,
  event: Record<string, unknown>,
): ChatStreamEvent {
  const response = responseObject(providerId, event);
  if (typeof response.id !== 'string' || typeof response.model !== 'string')
    throw providerError(
      providerId,
      'PROTOCOL_ERROR',
      'OpenAI response metadata is invalid',
    );
  const created = response.created_at;
  return {
    createdAt:
      typeof created === 'number' && Number.isFinite(created)
        ? new Date(created * 1_000).toISOString()
        : null,
    model: response.model,
    responseId: response.id,
    type: 'response-start',
  };
}

function usageEvent(
  providerId: string,
  response: Record<string, unknown>,
): ChatStreamEvent | null {
  const usage = response.usage;
  if (usage === undefined || usage === null) return null;
  if (typeof usage !== 'object' || Array.isArray(usage))
    throw providerError(
      providerId,
      'PROTOCOL_ERROR',
      'OpenAI returned invalid token usage',
    );
  const inputTokens = property(usage, 'input_tokens');
  const outputTokens = property(usage, 'output_tokens');
  const totalTokens = property(usage, 'total_tokens');
  if (
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    !Number.isInteger(totalTokens) ||
    (inputTokens as number) < 0 ||
    (outputTokens as number) < 0 ||
    (totalTokens as number) < 0
  )
    throw providerError(
      providerId,
      'PROTOCOL_ERROR',
      'OpenAI returned invalid token usage',
    );
  return {
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: totalTokens as number,
    type: 'usage',
  };
}

function safeRemoteMessage(value: unknown, apiKey: string): string {
  if (typeof value !== 'object' || value === null)
    return 'No diagnostic message';
  const message = property(value, 'message');
  return typeof message === 'string'
    ? message.slice(0, 512).replaceAll(apiKey, '[REDACTED]')
    : 'No diagnostic message';
}

async function* responseEvents(
  providerId: string,
  response: Response,
  apiKey: string,
): AsyncIterable<ChatStreamEvent> {
  if (response.body === null)
    throw providerError(
      providerId,
      'PROTOCOL_ERROR',
      'OpenAI returned a streaming response without a body',
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = new ServerSentEventDecoder();
  const state = { ended: false, started: false };
  const emit = function* (data: string): Iterable<ChatStreamEvent> {
    if (data === '[DONE]') return;
    const event = parseData(providerId, data);
    switch (event.type) {
      case 'response.created':
        if (state.started)
          throw providerError(
            providerId,
            'PROTOCOL_ERROR',
            'OpenAI emitted duplicate response metadata',
          );
        state.started = true;
        yield responseStart(providerId, event);
        return;
      case 'response.output_text.delta':
        if (typeof event.delta !== 'string')
          throw providerError(
            providerId,
            'PROTOCOL_ERROR',
            'OpenAI emitted an invalid text delta',
          );
        yield { delta: event.delta, type: 'text-delta' };
        return;
      case 'response.reasoning_summary_text.delta':
        if (typeof event.delta !== 'string')
          throw providerError(
            providerId,
            'PROTOCOL_ERROR',
            'OpenAI emitted an invalid reasoning delta',
          );
        yield { delta: event.delta, type: 'reasoning-delta' };
        return;
      case 'response.completed': {
        const completed = responseObject(providerId, event);
        const usage = usageEvent(providerId, completed);
        if (usage !== null) yield usage;
        state.ended = true;
        yield {
          finishReason: 'stop',
          rawFinishReason: 'completed',
          type: 'response-end',
        };
        return;
      }
      case 'response.incomplete': {
        const incomplete = responseObject(providerId, event);
        const usage = usageEvent(providerId, incomplete);
        if (usage !== null) yield usage;
        state.ended = true;
        yield {
          finishReason: 'length',
          rawFinishReason: 'incomplete',
          type: 'response-end',
        };
        return;
      }
      case 'error':
        throw providerError(
          providerId,
          'HTTP_ERROR',
          `OpenAI response failed: ${safeRemoteMessage(event.error, apiKey)}`,
        );
      default:
        return;
    }
  };
  try {
    let reading = true;
    while (reading) {
      const result = await reader.read();
      if (result.done) reading = false;
      else
        for (const data of sse.push(
          decoder.decode(result.value, { stream: true }),
        ))
          yield* emit(data);
    }
    for (const data of sse.push(decoder.decode())) yield* emit(data);
    for (const data of sse.finish()) yield* emit(data);
  } finally {
    reader.releaseLock();
  }
  if (!state.started || !state.ended)
    throw providerError(
      providerId,
      'PROTOCOL_ERROR',
      'OpenAI response stream ended before completion',
    );
}

class OpenAIResponsesProvider implements ChatProvider {
  readonly id: string;
  readonly name: string;
  readonly #apiKey: ApiKeySource;
  readonly #attachmentLoader: AttachmentLoader;
  readonly #baseUrl: URL;
  readonly #fetch: FetchImplementation;

  constructor(config: OpenAIResponsesProviderConfig) {
    if (config.id.trim().length === 0 || config.name.trim().length === 0)
      throw providerError(
        config.id,
        'CONFIGURATION_ERROR',
        'Provider id and name cannot be blank',
      );
    this.id = config.id;
    this.name = config.name;
    this.#apiKey = config.apiKey;
    this.#attachmentLoader = config.attachmentLoader;
    this.#baseUrl = validatedBaseUrl(
      config.id,
      config.baseUrl ?? 'https://api.openai.com/v1',
    );
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async *streamChat(
    request: ChatRequest,
    options: StreamChatOptions = {},
  ): AsyncIterable<ChatStreamEvent> {
    validateRequest(this.id, request);
    const apiKey = resolveApiKey(this.#apiKey);
    let response: Response;
    try {
      response = await this.#fetch(new URL('responses', this.#baseUrl), {
        body: JSON.stringify(
          await requestBody(this.id, this.#attachmentLoader, request),
        ),
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (cause) {
      if (cause instanceof ProviderError) throw cause;
      const canceled =
        options.signal?.aborted === true ||
        (cause instanceof DOMException && cause.name === 'AbortError');
      throw providerError(
        this.id,
        canceled ? 'CANCELED' : 'NETWORK_ERROR',
        canceled
          ? 'OpenAI request was canceled'
          : 'OpenAI network request failed',
        { cause },
      );
    }
    if (!response.ok) {
      let diagnostic = 'No diagnostic message';
      try {
        diagnostic = safeRemoteMessage(
          property(JSON.parse(await response.text()) as object, 'error'),
          apiKey,
        );
      } catch {
        // Unstructured provider bodies are intentionally not exposed.
      }
      throw providerError(
        this.id,
        'HTTP_ERROR',
        `OpenAI request failed with HTTP ${String(response.status)}: ${diagnostic}`,
        { status: response.status },
      );
    }
    yield* responseEvents(this.id, response, apiKey);
  }
}

export function createOpenAIResponsesProvider(
  config: OpenAIResponsesProviderConfig,
): ChatProvider {
  return new OpenAIResponsesProvider(config);
}
