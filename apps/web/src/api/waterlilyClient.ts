import {
  parseGenerationStreamLine,
  parseWorkspaceSnapshot,
  type AttachmentDescriptor,
  type CreateProviderProfileRequest,
  type GenerationApiRequest,
  type GenerationStreamItem,
  type ProviderDescriptor,
  type PythonExecutionRequest,
  type PythonExecutionResult,
  type WorkspaceSnapshot,
} from '@waterlily/api-contract';

export class WaterLilyApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'WaterLilyApiError';
  }
}

type FetchClient = typeof globalThis.fetch;

export interface DownloadedAttachment {
  readonly bytes: Uint8Array;
  readonly descriptor: AttachmentDescriptor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apiError(value: unknown, status: number): WaterLilyApiError {
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
      return new WaterLilyApiError(error.code, error.message, status);
  }
  return new WaterLilyApiError(
    'INVALID_RESPONSE',
    'The local service returned an invalid error response',
    status,
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new WaterLilyApiError(
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
    throw new WaterLilyApiError(
      'INVALID_RESPONSE',
      'The local service health response is invalid',
      200,
    );
  const providersValue: unknown = value.providers;
  if (!Array.isArray(providersValue))
    throw new WaterLilyApiError(
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
      !('models' in provider) ||
      !('name' in provider) ||
      !('providerType' in provider) ||
      !('source' in provider) ||
      typeof provider.available !== 'boolean' ||
      typeof provider.defaultModel !== 'string' ||
      typeof provider.id !== 'string' ||
      typeof provider.name !== 'string' ||
      !Array.isArray(provider.models) ||
      !['deepseek', 'openai', 'openai-compatible'].includes(
        String(provider.providerType),
      ) ||
      !['environment', 'stored'].includes(String(provider.source))
    )
      throw new WaterLilyApiError(
        'INVALID_RESPONSE',
        'The local service returned an invalid provider',
        200,
      );
    const models = provider.models.map((model) => {
      if (
        !isRecord(model) ||
        !isRecord(model.capabilities) ||
        typeof model.id !== 'string' ||
        typeof model.name !== 'string' ||
        typeof model.capabilities.nativeFiles !== 'boolean' ||
        (model.capabilities.maxFileBytes !== null &&
          (!Number.isSafeInteger(model.capabilities.maxFileBytes) ||
            (model.capabilities.maxFileBytes as number) <= 0)) ||
        !Array.isArray(model.capabilities.inputExtensions) ||
        !Array.isArray(model.capabilities.inputMimeTypes) ||
        model.capabilities.inputExtensions.some(
          (extension) => typeof extension !== 'string',
        ) ||
        model.capabilities.inputMimeTypes.some(
          (mediaType) => typeof mediaType !== 'string',
        )
      )
        throw new WaterLilyApiError(
          'INVALID_RESPONSE',
          'The local service returned an invalid provider model',
          200,
        );
      return {
        capabilities: {
          inputExtensions: model.capabilities.inputExtensions as string[],
          inputMimeTypes: model.capabilities.inputMimeTypes as string[],
          maxFileBytes: model.capabilities.maxFileBytes as number | null,
          nativeFiles: model.capabilities.nativeFiles,
        },
        id: model.id,
        name: model.name,
      };
    });
    return {
      available: provider.available,
      defaultModel: provider.defaultModel,
      id: provider.id,
      models,
      name: provider.name,
      providerType: provider.providerType as ProviderDescriptor['providerType'],
      source: provider.source as ProviderDescriptor['source'],
    };
  });
}

function attachmentDescriptor(value: unknown): AttachmentDescriptor {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.mediaType !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.sha256) ||
    !Number.isInteger(value.size) ||
    (value.size as number) < 0
  )
    throw new WaterLilyApiError(
      'INVALID_RESPONSE',
      'The local service returned invalid attachment metadata',
      200,
    );
  return value as unknown as AttachmentDescriptor;
}

function pythonExecutionResult(value: unknown): PythonExecutionResult {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.durationMilliseconds) ||
    (value.durationMilliseconds as number) < 0 ||
    (value.exitCode !== null && !Number.isSafeInteger(value.exitCode)) ||
    typeof value.stderr !== 'string' ||
    typeof value.stdout !== 'string' ||
    typeof value.timedOut !== 'boolean' ||
    typeof value.truncated !== 'boolean'
  )
    throw new WaterLilyApiError(
      'INVALID_RESPONSE',
      'The local service returned an invalid Python result',
      200,
    );
  return value as unknown as PythonExecutionResult;
}

async function decodeGeneration(
  response: Response,
  onItem: (item: GenerationStreamItem) => void,
): Promise<WorkspaceSnapshot> {
  if (!response.ok)
    throw apiError(await responseJson(response), response.status);
  if (response.body === null)
    throw new WaterLilyApiError(
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
      throw new WaterLilyApiError(
        'INVALID_RESPONSE',
        'The local service returned an invalid generation event',
        response.status,
        { cause },
      );
    }
    onItem(item);
    if (item.type === 'generation-error')
      throw new WaterLilyApiError(
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
    throw new WaterLilyApiError(
      'INCOMPLETE_RESPONSE',
      'The generation stream ended before committing a response',
      response.status,
    );
  return streamState.completed;
}

export class WaterLilyClient {
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

  public async createProviderProfile(
    input: CreateProviderProfileRequest,
  ): Promise<ProviderDescriptor> {
    const response = await this.#fetch('/api/provider-profiles', {
      body: JSON.stringify(input),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const profile = await checkedJson(response);
    return providerDescriptors({
      providers: [profile],
    })[0] as ProviderDescriptor;
  }

  public async removeProviderProfile(profileId: string): Promise<void> {
    const response = await this.#fetch(
      `/api/provider-profiles/${encodeURIComponent(profileId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok)
      throw apiError(await responseJson(response), response.status);
  }

  public async uploadAttachment(file: File): Promise<AttachmentDescriptor> {
    const response = await this.#fetch('/api/attachments', {
      body: file,
      headers: {
        Accept: 'application/json',
        'Content-Type': file.type || 'application/octet-stream',
        'X-WaterLily-Filename': encodeURIComponent(file.name),
      },
      method: 'POST',
    });
    return attachmentDescriptor(await checkedJson(response));
  }

  public async downloadAttachment(
    attachmentId: string,
  ): Promise<DownloadedAttachment> {
    const response = await this.#fetch(
      `/api/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { Accept: 'application/octet-stream' } },
    );
    if (!response.ok)
      throw apiError(await responseJson(response), response.status);
    const encodedName = response.headers.get('x-waterlily-filename');
    const sha256 = response.headers.get('x-waterlily-sha256');
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0];
    const declaredSize = Number(response.headers.get('content-length'));
    if (
      encodedName === null ||
      sha256 === null ||
      mediaType === undefined ||
      mediaType.length === 0 ||
      !Number.isSafeInteger(declaredSize) ||
      declaredSize < 0
    )
      throw new WaterLilyApiError(
        'INVALID_RESPONSE',
        'The local service returned invalid attachment headers',
        response.status,
      );
    let name: string;
    try {
      name = decodeURIComponent(encodedName);
    } catch (cause) {
      throw new WaterLilyApiError(
        'INVALID_RESPONSE',
        'The local service returned an invalid attachment name',
        response.status,
        { cause },
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      descriptor: attachmentDescriptor({
        id: attachmentId,
        mediaType,
        name,
        sha256,
        size: declaredSize,
      }),
    };
  }

  public async removeAttachment(attachmentId: string): Promise<void> {
    const response = await this.#fetch(
      `/api/attachments/${encodeURIComponent(attachmentId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok)
      throw apiError(await responseJson(response), response.status);
  }

  public async executePython(
    input: PythonExecutionRequest,
    signal?: AbortSignal,
  ): Promise<PythonExecutionResult> {
    const response = await this.#fetch('/api/executions/python', {
      body: JSON.stringify(input),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
    return pythonExecutionResult(await checkedJson(response));
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
      if (cause instanceof WaterLilyApiError) throw cause;
      throw new WaterLilyApiError(
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
      if (cause instanceof WaterLilyApiError) throw cause;
      throw new WaterLilyApiError(
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
