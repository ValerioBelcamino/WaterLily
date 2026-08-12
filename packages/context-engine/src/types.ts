import type {
  ContentBlock,
  GraphSnapshot,
  JsonValue,
  MessageRole,
  NodeKind,
} from '@llm-graph/domain';

export interface ContextHead {
  readonly label: string;
  readonly nodeId: string;
  readonly revisionId?: string;
  readonly slot: number;
}

export type ContextSelection =
  | { readonly mode: 'excluded' }
  | { readonly mode: 'full' }
  | { readonly blockIds: readonly string[]; readonly mode: 'blocks' };

export interface ContextOverride {
  readonly nodeId: string;
  readonly revisionId?: string;
  readonly selection: ContextSelection;
}

export interface TokenEstimator {
  readonly id: string;
  estimate(blocks: readonly ContentBlock[]): number;
}

export interface CompileContextInput {
  readonly graph: GraphSnapshot;
  readonly heads: readonly ContextHead[];
  readonly overrides?: readonly ContextOverride[];
  readonly tokenBudget?: number;
  readonly tokenEstimator?: TokenEstimator;
}

export interface CompiledContextItem {
  readonly blocks: readonly ContentBlock[];
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly nodeId: string;
  readonly nodeKind: NodeKind;
  readonly revisionId: string;
  readonly role: MessageRole | null;
  readonly title: string | null;
}

export interface CommonContextSegment {
  readonly items: readonly CompiledContextItem[];
  readonly kind: 'common';
}

export interface BranchContextSegment {
  readonly items: readonly CompiledContextItem[];
  readonly kind: 'branch';
  readonly label: string;
  readonly slot: number;
}

export interface ContextDecision {
  readonly includedBlockIds: readonly string[];
  readonly mode: ContextSelection['mode'];
  readonly nodeId: string;
  readonly revisionId: string;
}

export type ContextWarningCode =
  'TOKEN_BUDGET_EXCEEDED' | 'TOKEN_ESTIMATE_UNAVAILABLE';

export interface ContextWarning {
  readonly code: ContextWarningCode;
  readonly details: Readonly<Record<string, number | string>>;
  readonly message: string;
}

export interface CompiledContextWithoutHash {
  readonly branches: readonly BranchContextSegment[];
  readonly common: CommonContextSegment;
  readonly decisions: readonly ContextDecision[];
  readonly estimatedTokens: number | null;
  readonly estimatorId: string | null;
  readonly tokenBudget: number | null;
  readonly version: 1;
  readonly warnings: readonly ContextWarning[];
}

export interface CompiledContext extends CompiledContextWithoutHash {
  readonly hash: string;
}
