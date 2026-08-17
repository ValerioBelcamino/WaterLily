import { randomUUID } from 'node:crypto';

import {
  ApiContractError,
  parseCreateProviderProfileRequest,
  parseGenerationApiRequest,
  parsePythonExecutionRequest,
  parseWorkspaceWriteRequest,
  serializeNdjson,
  type GenerationStreamItem,
  type WorkspaceSnapshot,
} from '@waterlily/api-contract';
import { DatabaseError } from '@waterlily/database';
import { ProviderError } from '@waterlily/providers';
import {
  applyGenerationCommit,
  runGeneration,
  WorkflowError,
} from '@waterlily/workflows';

import type {
  RegisteredProvider,
  WaterLilyHandlerOptions,
  WorkspaceStore,
} from './types.js';

const JSON_TYPE = 'application/json; charset=utf-8';
const NDJSON_TYPE = 'application/x-ndjson; charset=utf-8';
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;

class HttpError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { ...SECURITY_HEADERS, 'content-type': JSON_TYPE },
    status,
  });
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin === null) return;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new HttpError(403, 'Cross-origin requests are not allowed');
  }
  if (originUrl.host !== new URL(request.url).host)
    throw new HttpError(403, 'Cross-origin requests are not allowed');
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new HttpError(415, 'Content-Type must be application/json');
  const bytes = await readBytes(request, maxBytes, 'A JSON body is required');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new HttpError(
      400,
      cause instanceof SyntaxError
        ? 'Request body is not valid JSON'
        : 'Request body is not valid UTF-8 JSON',
    );
  }
}

async function readBytes(
  request: Request,
  maxBytes: number,
  missingMessage = 'A request body is required',
): Promise<Uint8Array> {
  if (request.body === null) throw new HttpError(400, missingMessage);
  const reader =
    request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let result = await reader.read();
  while (!result.done) {
    size += result.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'Request body exceeds the configured limit');
    }
    chunks.push(result.value);
    result = await reader.read();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function graphIdFromPath(pathname: string): string | null {
  const match = /^\/api\/workspaces\/([^/]+)$/u.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] as string);
  } catch {
    throw new HttpError(400, 'Workspace path is malformed');
  }
}

function providerProfileIdFromPath(pathname: string): string | null {
  const match = /^\/api\/provider-profiles\/([^/]+)$/u.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] as string);
  } catch {
    throw new HttpError(400, 'Provider profile path is malformed');
  }
}

function providerRegistrations(
  providers: WaterLilyHandlerOptions['providers'],
): readonly RegisteredProvider[] {
  return typeof providers === 'function' ? providers() : providers;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

function safeError(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof HttpError)
    return { code: `HTTP_${String(error.status)}`, message: error.message };
  if (
    error instanceof ProviderError ||
    error instanceof WorkflowError ||
    error instanceof ApiContractError
  )
    return {
      code: error instanceof ApiContractError ? 'INVALID_REQUEST' : error.code,
      message: error.message,
    };
  if (error instanceof DatabaseError)
    return {
      code: error.code,
      message:
        error.code === 'NOT_FOUND'
          ? 'The generation graph was not found'
          : error.code === 'CONFLICT'
            ? 'The graph changed while the response was being committed'
            : 'The generated response could not be persisted',
    };
  return { code: 'INTERNAL_ERROR', message: 'Generation failed unexpectedly' };
}

function statusFor(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof ApiContractError) return 400;
  if (error instanceof DatabaseError) {
    if (error.code === 'ALREADY_EXISTS' || error.code === 'CONFLICT')
      return 409;
    if (error.code === 'NOT_FOUND') return 404;
  }
  return 500;
}

function publicError(error: unknown): {
  readonly error: { readonly code: string; readonly message: string };
} {
  if (error instanceof HttpError)
    return {
      error: { code: `HTTP_${String(error.status)}`, message: error.message },
    };
  if (error instanceof ApiContractError)
    return { error: { code: 'INVALID_REQUEST', message: error.message } };
  if (error instanceof DatabaseError) return { error: safeError(error) };
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The request failed unexpectedly',
    },
  };
}

function findProvider(
  providers: readonly RegisteredProvider[],
  providerId: string,
): RegisteredProvider & {
  readonly provider: NonNullable<RegisteredProvider['provider']>;
} {
  const registration = providers.find(
    (candidate) => candidate.descriptor.id === providerId,
  );
  if (registration === undefined)
    throw new HttpError(400, 'The requested provider is unknown');
  if (!registration.descriptor.available || registration.provider === undefined)
    throw new HttpError(
      503,
      'The requested provider is not configured on this service',
    );
  return { ...registration, provider: registration.provider };
}

function commitLatest(
  store: WorkspaceStore,
  graphId: string,
  commit: Parameters<typeof applyGenerationCommit>[1],
): WorkspaceSnapshot {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = store.get(graphId);
    if (latest === null)
      throw new DatabaseError('NOT_FOUND', 'Graph no longer exists');
    const workspace = {
      graph: applyGenerationCommit(latest.graph, commit),
      state: latest.state,
    };
    try {
      store.replace(workspace, latest.graph.updatedAt);
      return workspace;
    } catch (error: unknown) {
      if (
        !(error instanceof DatabaseError) ||
        error.code !== 'CONFLICT' ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new Error('Unreachable persistence retry state');
}

function generationResponse(
  requestValue: unknown,
  options: Required<Pick<WaterLilyHandlerOptions, 'createId' | 'now'>> &
    WaterLilyHandlerOptions,
): Response {
  const abortController = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
      abortController.abort();
    },
    start(controller) {
      const emit = (item: GenerationStreamItem): void => {
        if (cancelled) return;
        controller.enqueue(new TextEncoder().encode(serializeNdjson(item)));
      };
      void (async () => {
        try {
          const preliminary =
            typeof requestValue === 'object' && requestValue !== null
              ? (requestValue as { readonly graphId?: unknown })
              : {};
          if (typeof preliminary.graphId !== 'string')
            throw new ApiContractError('generation graphId must be a string');
          const workspace = options.workspaces.get(preliminary.graphId);
          if (workspace === null)
            throw new DatabaseError(
              'NOT_FOUND',
              'Generation graph does not exist',
            );
          const input = parseGenerationApiRequest(
            requestValue,
            workspace.graph,
          );
          const registration = findProvider(
            providerRegistrations(options.providers),
            input.providerId,
          );
          const result = await runGeneration({
            context: input.context,
            graph: workspace.graph,
            onEvent: (event) => emit({ event, type: 'provider-event' }),
            output: {
              blockId: options.createId('block'),
              contextEdgeIds: input.context.heads.map(() =>
                options.createId('edge'),
              ),
              createdAt: options.now(),
              nodeId: options.createId('node'),
              revisionId: options.createId('revision'),
              title: input.title,
            },
            provider: registration.provider,
            request: input.request,
            signal: abortController.signal,
          });
          emit({
            type: 'generation-complete',
            workspace: commitLatest(
              options.workspaces,
              input.graphId,
              result.commit,
            ),
          });
        } catch (error: unknown) {
          if (!cancelled)
            emit({ error: safeError(error), type: 'generation-error' });
        } finally {
          if (!cancelled) controller.close();
        }
      })();
    },
  });
  return new Response(stream, {
    headers: { ...SECURITY_HEADERS, 'content-type': NDJSON_TYPE },
  });
}

export function createWaterLilyHandler(
  options: WaterLilyHandlerOptions,
): (request: Request) => Promise<Response> {
  const resolved = {
    ...options,
    createId:
      options.createId ??
      ((kind: 'block' | 'edge' | 'node' | 'revision') =>
        `${kind}-${randomUUID()}`),
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    now: options.now ?? (() => new Date().toISOString()),
  };
  return async (request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/health')
        return jsonResponse({
          providers: providerRegistrations(resolved.providers).map(
            (provider) => provider.descriptor,
          ),
          service: 'waterlily',
          version: '0.0.0',
        });
      if (
        request.method === 'POST' &&
        url.pathname === '/api/provider-profiles'
      ) {
        assertSameOrigin(request);
        if (resolved.providerProfiles === undefined)
          throw new HttpError(503, 'Provider profile storage is unavailable');
        const input = parseCreateProviderProfileRequest(
          await readJson(request, resolved.maxBodyBytes),
        );
        return jsonResponse(resolved.providerProfiles.create(input), 201);
      }
      const providerProfileId = providerProfileIdFromPath(url.pathname);
      if (providerProfileId !== null && request.method === 'DELETE') {
        assertSameOrigin(request);
        if (resolved.providerProfiles === undefined)
          throw new HttpError(503, 'Provider profile storage is unavailable');
        if (!resolved.providerProfiles.remove(providerProfileId))
          throw new HttpError(404, 'Provider profile not found');
        return new Response(null, {
          headers: SECURITY_HEADERS,
          status: 204,
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/attachments') {
        assertSameOrigin(request);
        if (resolved.attachments === undefined)
          throw new HttpError(503, 'Attachment storage is unavailable');
        const encodedName = request.headers.get('x-waterlily-filename');
        if (encodedName === null)
          throw new HttpError(400, 'Attachment filename is required');
        let name: string;
        try {
          name = decodeURIComponent(encodedName);
        } catch {
          throw new HttpError(400, 'Attachment filename is malformed');
        }
        if (
          name.trim().length === 0 ||
          name.length > 255 ||
          hasControlCharacter(name)
        )
          throw new HttpError(400, 'Attachment filename is invalid');
        const mediaType = request.headers
          .get('content-type')
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase();
        if (mediaType === undefined || mediaType.length === 0)
          throw new HttpError(415, 'Attachment Content-Type is required');
        const bytes = await readBytes(request, resolved.maxBodyBytes);
        if (bytes.byteLength === 0)
          throw new HttpError(400, 'Attachment cannot be empty');
        return jsonResponse(
          resolved.attachments.put({ bytes, mediaType, name }),
          201,
        );
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/api/executions/python'
      ) {
        assertSameOrigin(request);
        if (resolved.codeRunner === undefined)
          throw new HttpError(503, 'Local Python execution is unavailable');
        const input = parsePythonExecutionRequest(
          await readJson(request, resolved.maxBodyBytes),
        );
        return jsonResponse(
          await resolved.codeRunner.run(input, request.signal),
        );
      }
      const graphId = graphIdFromPath(url.pathname);
      if (graphId !== null && request.method === 'GET') {
        const workspace = resolved.workspaces.get(graphId);
        return workspace === null
          ? jsonResponse(
              { error: { code: 'NOT_FOUND', message: 'Workspace not found' } },
              404,
            )
          : jsonResponse(workspace);
      }
      if (graphId !== null && request.method === 'PUT') {
        assertSameOrigin(request);
        const input = parseWorkspaceWriteRequest(
          await readJson(request, resolved.maxBodyBytes),
        );
        if (input.graph.id !== graphId)
          throw new HttpError(400, 'Workspace path and graph id do not match');
        const workspace = { graph: input.graph, state: input.state };
        if (input.expectedUpdatedAt === null)
          resolved.workspaces.insert(workspace);
        else resolved.workspaces.replace(workspace, input.expectedUpdatedAt);
        return jsonResponse(
          workspace,
          input.expectedUpdatedAt === null ? 201 : 200,
        );
      }
      if (request.method === 'POST' && url.pathname === '/api/generations') {
        assertSameOrigin(request);
        const body = await readJson(request, resolved.maxBodyBytes);
        return generationResponse(body, resolved);
      }
      return jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'Route not found' } },
        404,
      );
    } catch (error: unknown) {
      return jsonResponse(publicError(error), statusFor(error));
    }
  };
}
