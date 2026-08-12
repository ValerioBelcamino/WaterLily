import type {
  ContextHead,
  ContextOverride,
  ContextSelection,
} from '@llm-graph/context-engine';
import type { GraphSnapshot } from '@llm-graph/domain';
import type { GraphViewState } from '@llm-graph/interchange';
import type { ChatRequest, ChatStreamEvent } from '@llm-graph/providers';

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

export interface ProviderDescriptor {
  readonly available: boolean;
  readonly defaultModel: string;
  readonly id: string;
  readonly name: string;
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
