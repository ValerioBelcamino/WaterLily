import type {
  AttachmentDescriptor,
  CreateProviderProfileRequest,
  ProviderDescriptor,
  PythonExecutionRequest,
  PythonExecutionResult,
  WorkspaceSnapshot,
} from '@waterlily/api-contract';
import type { ChatProvider } from '@waterlily/providers';
import type { LoadedAttachment } from '@waterlily/providers';

export interface WorkspaceStore {
  get(graphId: string): WorkspaceSnapshot | null;
  insert(workspace: WorkspaceSnapshot): void;
  replace(workspace: WorkspaceSnapshot, expectedUpdatedAt: string): void;
}

export interface RegisteredProvider {
  readonly descriptor: ProviderDescriptor;
  readonly provider?: ChatProvider;
}

export interface AttachmentStore {
  get(id: string): LoadedAttachment;
  read(id: string): {
    readonly bytes: Uint8Array;
    readonly descriptor: AttachmentDescriptor;
  } | null;
  remove(id: string): boolean;
  put(input: {
    readonly bytes: Uint8Array;
    readonly mediaType: string;
    readonly name: string;
  }): AttachmentDescriptor;
}

export interface ProviderProfileStore {
  create(input: CreateProviderProfileRequest): ProviderDescriptor;
  remove(id: string): boolean;
}

export interface CodeRunner {
  run(
    input: PythonExecutionRequest,
    signal?: AbortSignal,
  ): Promise<PythonExecutionResult>;
}

export interface WaterLilyHandlerOptions {
  readonly attachments?: AttachmentStore;
  readonly createId?: (kind: 'block' | 'edge' | 'node' | 'revision') => string;
  readonly codeRunner?: CodeRunner;
  readonly maxBodyBytes?: number;
  readonly now?: () => string;
  readonly providerProfiles?: ProviderProfileStore;
  readonly providers:
    readonly RegisteredProvider[] | (() => readonly RegisteredProvider[]);
  readonly workspaces: WorkspaceStore;
}
