import {
  parseGenerationStreamLine,
  parseWorkspaceSnapshot,
  type GenerationApiRequest,
  type GenerationStreamItem,
  type ProviderDescriptor,
  type WorkspaceSnapshot,
} from '@llm-graph/api-contract';

export class WorkbenchApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'WorkbenchApiError';
  }
}

type FetchClient = typeof globalThis.fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apiError(value: unknown, status: number): WorkbenchApiError {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    const error = value.error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof error.code === 'string' &&
      typeof error.message === 'string'
    )
      return new WorkbenchApiError(error.code, error.message, status);
  }
  return new WorkbenchApiError(
    'INVALID_RESPONSE',
    'The local service returned an invalid error response',
    status,
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new WorkbenchApiError(
      'INVALID_RESPONSE',
      'The local service returned invalid JSON',
      response.status,
      { cause },
    );
  }
}

async function checkedJson(response: Response): Promise<unknown> {
  const value = await responseJson(response);
  if (!response.ok) throw apiError(value, response.status);
  return value;
}

function providerDescriptors(value: unknown): readonly ProviderDescriptor[] {
  if (!isRecord(value) || !('providers' in value))
    throw new WorkbenchApiError(
      'INVALID_RESPONSE',
      'The local service health response is invalid',
      200,
    );
  const providersValue: unknown = value.providers;
  if (!Array.isArray(providersValue))
    throw new WorkbenchApiError(
      'INVALID_RESPONSE',
      'The local service provider list is invalid',
      200,
    );
  const providers: readonly unknown[] = providersValue;
  return providers.map((provider): ProviderDescriptor => {
    if (
      !isRecord(provider) ||
      !('available' in provider) ||
      !('defaultModel' in provider) ||
      !('id' in provider) ||
      !('name' in provider) ||
      typeof provider.available !== 'boolean' ||
      typeof provider.defaultModel !== 'string' ||
      typeof provider.id !== 'string' ||
      typeof provider.name !== 'string'
    )
      throw new WorkbenchApiError(
        'INVALID_RESPONSE',
        'The local service returned an invalid provider',
        200,
      );
    return {
      available: provider.available,
      defaultModel: provider.defaultModel,
      id: provider.id,
      name: provider.name,
    };
  });
}

async function decodeGeneration(
  response: Response,
  onItem: (item: GenerationStreamItem) => void,
): Promise<WorkspaceSnapshot> {
  if (!response.ok)
    throw apiError(await responseJson(response), response.status);
  if (response.body === null)
    throw new WorkbenchApiError(
      'INVALID_RESPONSE',
      'The generation response has no stream',
      response.status,
    );
  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = '';
  const streamState: { completed: WorkspaceSnapshot | null } = {
    completed: null,
  };
  const consume = (line: string): void => {
    if (line.trim().length === 0) return;
    let item: GenerationStreamItem;
    try {
      item = parseGenerationStreamLine(line.trimEnd());
    } catch (cause) {
      throw new WorkbenchApiError(
        'INVALID_RESPONSE',
        'The local service returned an invalid generation event',
        response.status,
        { cause },
      );
    }
    onItem(item);
    if (item.type === 'generation-error')
      throw new WorkbenchApiError(
        item.error.code,
        item.error.message,
        response.status,
      );
    if (item.type === 'generation-complete')
      streamState.completed = item.workspace;
  };

  let result = await reader.read();
  while (!result.done) {
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) consume(line);
    result = await reader.read();
  }
  buffer += decoder.decode();
  consume(buffer);
  if (streamState.completed === null)
    throw new WorkbenchApiError(
      'INCOMPLETE_RESPONSE',
      'The generation stream ended before committing a response',
      response.status,
    );
  return streamState.completed;
}

export class WorkbenchClient {
  readonly #fetch: FetchClient;

  public constructor(fetchClient: FetchClient = globalThis.fetch) {
    this.#fetch = fetchClient.bind(globalThis);
  }

  public async health(): Promise<readonly ProviderDescriptor[]> {
    return providerDescriptors(
      await checkedJson(
        await this.#fetch('/api/health', {
          headers: { Accept: 'application/json' },
        }),
      ),
    );
  }

  public async load(graphId: string): Promise<WorkspaceSnapshot | null> {
    const response = await this.#fetch(
      `/api/workspaces/${encodeURIComponent(graphId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (response.status === 404) return null;
    try {
      return parseWorkspaceSnapshot(await checkedJson(response));
    } catch (cause) {
      if (cause instanceof WorkbenchApiError) throw cause;
      throw new WorkbenchApiError(
        'INVALID_RESPONSE',
        'The local service returned an invalid workspace',
        response.status,
        { cause },
      );
    }
  }

  public async save(
    workspace: WorkspaceSnapshot,
    expectedUpdatedAt: string | null,
  ): Promise<WorkspaceSnapshot> {
    const response = await this.#fetch(
      `/api/workspaces/${encodeURIComponent(workspace.graph.id)}`,
      {
        body: JSON.stringify({ ...workspace, expectedUpdatedAt }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      },
    );
    try {
      return parseWorkspaceSnapshot(await checkedJson(response));
    } catch (cause) {
      if (cause instanceof WorkbenchApiError) throw cause;
      throw new WorkbenchApiError(
        'INVALID_RESPONSE',
        'The local service returned an invalid saved workspace',
        response.status,
        { cause },
      );
    }
  }

  public async generate(
    input: GenerationApiRequest,
    onItem: (item: GenerationStreamItem) => void,
    signal?: AbortSignal,
  ): Promise<WorkspaceSnapshot> {
    const response = await this.#fetch('/api/generations', {
      body: JSON.stringify(input),
      headers: {
        Accept: 'application/x-ndjson',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
    return decodeGeneration(response, onItem);
  }
}
