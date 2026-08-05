import type {
  ProviderDescriptor,
  WorkspaceSnapshot,
} from '@waterlily/api-contract';
import type { ChatProvider } from '@waterlily/providers';

export interface WorkspaceStore {
  get(graphId: string): WorkspaceSnapshot | null;
  insert(workspace: WorkspaceSnapshot): void;
  replace(workspace: WorkspaceSnapshot, expectedUpdatedAt: string): void;
}

export interface RegisteredProvider {
  readonly descriptor: ProviderDescriptor;
  readonly provider?: ChatProvider;
}

export interface WaterLilyHandlerOptions {
  readonly createId?: (kind: 'block' | 'edge' | 'node' | 'revision') => string;
  readonly maxBodyBytes?: number;
  readonly now?: () => string;
  readonly providers: readonly RegisteredProvider[];
  readonly workspaces: WorkspaceStore;
}
