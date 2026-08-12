import { randomUUID } from 'node:crypto';

import {
  ApiContractError,
  parseGenerationApiRequest,
  parseWorkspaceWriteRequest,
  serializeNdjson,
  type GenerationStreamItem,
  type WorkspaceSnapshot,
} from '@llm-graph/api-contract';
import { DatabaseError } from '@llm-graph/database';
import { ProviderError } from '@llm-graph/providers';
import {
  applyGenerationCommit,
  runGeneration,
  WorkflowError,
} from '@llm-graph/workflows';

import type {
  RegisteredProvider,
  WorkbenchHandlerOptions,
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
  if (request.body === null)
    throw new HttpError(400, 'A JSON body is required');
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

function graphIdFromPath(pathname: string): string | null {
  const match = /^\/api\/workspaces\/([^/]+)$/u.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] as string);
  } catch {
    throw new HttpError(400, 'Workspace path is malformed');
  }
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
  options: Required<Pick<WorkbenchHandlerOptions, 'createId' | 'now'>> &
    WorkbenchHandlerOptions,
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
            options.providers,
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

export function createWorkbenchHandler(
  options: WorkbenchHandlerOptions,
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
          providers: resolved.providers.map((provider) => provider.descriptor),
          service: 'llm-graph-workbench',
          version: '0.0.0',
        });
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
