import type {
  CompileContextInput,
  CompiledContext,
  ContextHead,
} from '@llm-graph/context-engine';
import type { GraphSnapshot, JsonValue } from '@llm-graph/domain';
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  FinishReason,
  UsageEvent,
} from '@llm-graph/providers';

export interface NewMessageNode {
  readonly blockId: string;
  readonly createdAt: string;
  readonly nodeId: string;
  readonly revisionId: string;
  readonly text: string;
  readonly title?: string | null;
}

export interface BranchInput {
  readonly edgeId: string;
  readonly graph: GraphSnapshot;
  readonly message: NewMessageNode;
  readonly parentNodeId: string;
  readonly parentRevisionId?: string;
}

export interface MergeInput {
  readonly edgeIds: readonly string[];
  readonly graph: GraphSnapshot;
  readonly heads: readonly {
    readonly label?: string | null;
    readonly nodeId: string;
    readonly revisionId?: string;
  }[];
  readonly message: NewMessageNode;
}

export interface SplitPart {
  readonly blockId: string;
  readonly contextEdgeIds: readonly string[];
  readonly nodeId: string;
  readonly provenanceEdgeId: string;
  readonly revisionId: string;
  readonly sourceBlockIds: readonly string[];
  readonly text: string;
  readonly title?: string | null;
}

export interface SplitInput {
  readonly createdAt: string;
  readonly graph: GraphSnapshot;
  readonly parts: readonly SplitPart[];
  readonly sourceNodeId: string;
  readonly sourceRevisionId?: string;
}

export interface SplitResult {
  readonly graph: GraphSnapshot;
  readonly nodeIds: readonly string[];
}

export interface SerializedProviderRequest {
  readonly contextHash: string;
  readonly request: ChatRequest;
}

export interface GenerationOutputIdentity {
  readonly blockId: string;
  readonly contextEdgeIds: readonly string[];
  readonly createdAt: string;
  readonly nodeId: string;
  readonly revisionId: string;
  readonly title?: string | null;
}

export interface RunGenerationInput {
  readonly context: Omit<CompileContextInput, 'graph'>;
  readonly graph: GraphSnapshot;
  readonly onEvent?: (event: ChatStreamEvent) => Promise<void> | void;
  readonly output: GenerationOutputIdentity;
  readonly provider: ChatProvider;
  readonly request: Omit<ChatRequest, 'messages'>;
  readonly signal?: AbortSignal;
}

export interface GeneratedResponseCommit {
  readonly content: string;
  readonly contextEdges: readonly {
    readonly edgeId: string;
    readonly label: string;
    readonly slot: number;
    readonly sourceNodeId: string;
    readonly sourceRevisionId: string;
  }[];
  readonly generation: {
    readonly contextHash: string;
    readonly finishReason: FinishReason;
    readonly model: string;
    readonly providerId: string;
    readonly responseId: string;
    readonly serializedRequest: SerializedProviderRequest;
    readonly usage: Omit<UsageEvent, 'type'> | null;
  };
  readonly output: GenerationOutputIdentity;
  readonly reasoning: string;
}

export interface GenerationResult {
  readonly commit: GeneratedResponseCommit;
  readonly compiledContext: CompiledContext;
  readonly graph: GraphSnapshot;
  readonly serializedRequest: SerializedProviderRequest;
}

export type GenerationContextHead = ContextHead;

export type RevisionMetadata = Readonly<Record<string, JsonValue>>;
