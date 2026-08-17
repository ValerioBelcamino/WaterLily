import type {
  ContextHead,
  ContextOverride,
  ContextSelection,
} from '@waterlily/context-engine';
import type { GraphSnapshot } from '@waterlily/domain';
import type { GraphViewState } from '@waterlily/interchange';
import type { ChatRequest, ChatStreamEvent } from '@waterlily/providers';

export interface WorkspaceStateV1 {
  readonly contextSelections: Readonly<Record<string, ContextSelection>>;
  readonly version: 1;
  readonly view: GraphViewState;
}

export interface WorkspaceSnapshot {
  readonly graph: GraphSnapshot;
  readonly state: WorkspaceStateV1;
}

export interface WorkspaceWriteRequest extends WorkspaceSnapshot {
  readonly expectedUpdatedAt: string | null;
}

export interface GenerationApiRequest {
  readonly context: {
    readonly heads: readonly ContextHead[];
    readonly overrides: readonly ContextOverride[];
    readonly tokenBudget?: number;
  };
  readonly graphId: string;
  readonly providerId: string;
  readonly request: Omit<ChatRequest, 'messages' | 'providerOptions'>;
  readonly title: string | null;
}

export interface ModelCapabilities {
  readonly inputExtensions: readonly string[];
  readonly inputMimeTypes: readonly string[];
  readonly maxFileBytes: number | null;
  readonly nativeFiles: boolean;
}

export interface ModelDescriptor {
  readonly capabilities: ModelCapabilities;
  readonly contextWindowTokens?: number | null;
  readonly id: string;
  readonly maxOutputTokens?: number | null;
  readonly name: string;
}

export interface ProviderDescriptor {
  readonly available: boolean;
  readonly defaultModel: string;
  readonly id: string;
  readonly models: readonly ModelDescriptor[];
  readonly name: string;
  readonly providerType: 'deepseek' | 'openai' | 'openai-compatible';
  readonly source: 'environment' | 'stored';
}

export interface CreateProviderProfileRequest {
  readonly apiKey: string | null;
  readonly baseUrl: string | null;
  readonly label: string;
  readonly models: readonly string[];
  readonly providerType: ProviderDescriptor['providerType'];
}

export interface AttachmentDescriptor {
  readonly id: string;
  readonly mediaType: string;
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
}

export interface PythonCodeCell {
  readonly nodeId: string;
  readonly source: string;
}

export interface PythonExecutionRequest {
  readonly cells: readonly PythonCodeCell[];
  readonly graphId: string;
}

export interface PythonExecutionResult {
  readonly durationMilliseconds: number;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

export type GenerationStreamItem =
  | {
      readonly event: ChatStreamEvent;
      readonly type: 'provider-event';
    }
  | {
      readonly type: 'generation-complete';
      readonly workspace: WorkspaceSnapshot;
    }
  | {
      readonly error: { readonly code: string; readonly message: string };
      readonly type: 'generation-error';
    };
