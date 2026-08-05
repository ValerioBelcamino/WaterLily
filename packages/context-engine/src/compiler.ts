import {
  validateGraph,
  type ContentBlock,
  type ContextEdge,
  type GraphNode,
  type GraphSnapshot,
  type NodeRevision,
} from '@waterlily/domain';

import { canonicalJson, sha256 } from './canonical.js';
import { failContext } from './errors.js';
import type {
  BranchContextSegment,
  CompileContextInput,
  CompiledContext,
  CompiledContextItem,
  CompiledContextWithoutHash,
  ContextDecision,
  ContextHead,
  ContextOverride,
  ContextSelection,
  ContextWarning,
} from './types.js';

interface ResolvedHead extends ContextHead {
  readonly revisionId: string;
}

interface ReachableContext {
  readonly itemByKey: ReadonlyMap<string, CompiledContextItem>;
  readonly orderedKeys: readonly string[];
}

interface HeadContextPair {
  readonly context: ReachableContext;
  readonly head: ResolvedHead;
}

type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]];

function itemKey(nodeId: string, revisionId: string): string {
  return `${nodeId}\u0000${revisionId}`;
}

function validateSlot(slot: number, code: 'INVALID_HEAD'): void {
  if (!Number.isInteger(slot) || slot < 0) {
    failContext(code, 'Context head slots must be non-negative integers', {
      slot,
    });
  }
}

function resolveHeads(
  graph: GraphSnapshot,
  heads: readonly ContextHead[],
): NonEmptyReadonlyArray<ResolvedHead> {
  if (heads.length === 0) {
    failContext('INVALID_HEAD', 'At least one context head is required');
  }

  const slots = new Set<number>();
  const resolved = heads.map((head): ResolvedHead => {
    validateSlot(head.slot, 'INVALID_HEAD');
    if (slots.has(head.slot)) {
      failContext('DUPLICATE_HEAD_SLOT', 'Context head slots must be unique', {
        slot: head.slot,
      });
    }
    slots.add(head.slot);
    if (head.label.trim().length === 0) {
      failContext('INVALID_HEAD', 'Context head labels cannot be blank', {
        nodeId: head.nodeId,
      });
    }

    const node = graph.nodes[head.nodeId];
    if (node?.deletedAt !== null) {
      failContext('NOT_FOUND', `Context head ${head.nodeId} is unavailable`, {
        nodeId: head.nodeId,
      });
    }
    const revisionId = head.revisionId ?? node.currentRevisionId;
    const revision = graph.revisions[revisionId];
    if (revision?.nodeId !== node.id) {
      failContext('INVALID_HEAD', 'A head revision must belong to its node', {
        nodeId: node.id,
        revisionId,
      });
    }
    return { ...head, revisionId };
  });

  return resolved.sort(
    (left, right) => left.slot - right.slot,
  ) as unknown as NonEmptyReadonlyArray<ResolvedHead>;
}

function sortedIncomingContextEdges(
  graph: GraphSnapshot,
  targetNodeId: string,
): readonly ContextEdge[] {
  return Object.values(graph.edges)
    .filter(
      (edge): edge is ContextEdge =>
        edge.kind === 'context' && edge.targetNodeId === targetNodeId,
    )
    .sort((left, right) => left.slot - right.slot);
}

function toCompiledItem(
  graph: GraphSnapshot,
  nodeId: string,
  revision: NodeRevision,
): CompiledContextItem {
  const node = graph.nodes[nodeId] as GraphNode;
  return {
    blocks: revision.blocks,
    metadata: revision.metadata,
    nodeId,
    nodeKind: node.kind,
    revisionId: revision.id,
    role: node.role,
    title: node.title,
  };
}

function collectReachable(
  graph: GraphSnapshot,
  head: ResolvedHead,
): ReachableContext {
  const emitted = new Set<string>();
  const orderedKeys: string[] = [];
  const itemByKey = new Map<string, CompiledContextItem>();

  const visit = (nodeId: string, revisionId: string): void => {
    const key = itemKey(nodeId, revisionId);
    if (emitted.has(key)) {
      return;
    }

    for (const edge of sortedIncomingContextEdges(graph, nodeId)) {
      visit(edge.sourceNodeId, edge.sourceRevisionId);
    }

    const revision = graph.revisions[revisionId] as NodeRevision;
    itemByKey.set(key, toCompiledItem(graph, nodeId, revision));
    emitted.add(key);
    orderedKeys.push(key);
  };

  visit(head.nodeId, head.revisionId);
  return { itemByKey, orderedKeys };
}

function overrideSelectorKey(override: ContextOverride): string {
  return `${override.nodeId}\u0000${override.revisionId ?? '*'}`;
}

function validateOverrides(
  graph: GraphSnapshot,
  overrides: readonly ContextOverride[],
): void {
  const selectors = new Set<string>();
  for (const override of overrides) {
    const selector = overrideSelectorKey(override);
    if (selectors.has(selector)) {
      failContext('DUPLICATE_OVERRIDE', 'Context overrides must be unique', {
        nodeId: override.nodeId,
        revisionId: override.revisionId ?? '*',
      });
    }
    selectors.add(selector);

    const node = graph.nodes[override.nodeId];
    if (node === undefined) {
      failContext('INVALID_OVERRIDE', 'An override references a missing node', {
        nodeId: override.nodeId,
      });
    }
    if (override.revisionId !== undefined) {
      const revision = graph.revisions[override.revisionId];
      if (revision?.nodeId !== node.id) {
        failContext(
          'INVALID_OVERRIDE',
          'An override revision must belong to its node',
          { nodeId: node.id, revisionId: override.revisionId },
        );
      }
    }
    if (
      override.selection.mode === 'blocks' &&
      override.selection.blockIds.length === 0
    ) {
      failContext(
        'INVALID_BLOCK_SELECTION',
        'A block selection cannot be empty',
        { nodeId: override.nodeId },
      );
    }
  }
}

function findSelection(
  item: CompiledContextItem,
  overrides: readonly ContextOverride[],
): ContextSelection {
  const exact = overrides.find(
    (override) =>
      override.nodeId === item.nodeId &&
      override.revisionId === item.revisionId,
  );
  if (exact !== undefined) {
    return exact.selection;
  }
  return (
    overrides.find(
      (override) =>
        override.nodeId === item.nodeId && override.revisionId === undefined,
    )?.selection ?? { mode: 'full' }
  );
}

function applySelection(
  item: CompiledContextItem,
  selection: ContextSelection,
): {
  readonly decision: ContextDecision;
  readonly item: CompiledContextItem | null;
} {
  if (selection.mode === 'excluded') {
    return {
      decision: {
        includedBlockIds: [],
        mode: selection.mode,
        nodeId: item.nodeId,
        revisionId: item.revisionId,
      },
      item: null,
    };
  }

  let blocks: readonly ContentBlock[] = item.blocks;
  if (selection.mode === 'blocks') {
    const selectedIds = new Set(selection.blockIds);
    if (selectedIds.size !== selection.blockIds.length) {
      failContext(
        'INVALID_BLOCK_SELECTION',
        'Selected block identifiers must be unique',
        { nodeId: item.nodeId, revisionId: item.revisionId },
      );
    }
    blocks = item.blocks.filter((block) => selectedIds.has(block.id));
    if (blocks.length !== selectedIds.size) {
      failContext(
        'INVALID_BLOCK_SELECTION',
        'Every selected block must exist in the selected revision',
        {
          nodeId: item.nodeId,
          revisionId: item.revisionId,
        },
      );
    }
  }

  return {
    decision: {
      includedBlockIds: blocks.map((block) => block.id),
      mode: selection.mode,
      nodeId: item.nodeId,
      revisionId: item.revisionId,
    },
    item: { ...item, blocks },
  };
}

function estimateTokens(
  items: readonly CompiledContextItem[],
  input: CompileContextInput,
): {
  readonly estimatedTokens: number | null;
  readonly estimatorId: string | null;
  readonly warnings: readonly ContextWarning[];
} {
  const estimator = input.tokenEstimator;
  if (estimator === undefined) {
    return {
      estimatedTokens: null,
      estimatorId: null,
      warnings: [
        {
          code: 'TOKEN_ESTIMATE_UNAVAILABLE',
          details: {},
          message: 'No token estimator was supplied; no content was discarded.',
        },
      ],
    };
  }
  if (estimator.id.trim().length === 0) {
    failContext('INVALID_ESTIMATE', 'Token estimators require a non-blank id');
  }

  const estimatedTokens = items.reduce((total, item) => {
    const estimate = estimator.estimate(item.blocks);
    if (!Number.isInteger(estimate) || estimate < 0) {
      failContext(
        'INVALID_ESTIMATE',
        'Token estimators must return non-negative integers',
        { estimate, estimatorId: estimator.id },
      );
    }
    return total + estimate;
  }, 0);

  const warnings: ContextWarning[] = [];
  if (input.tokenBudget !== undefined && estimatedTokens > input.tokenBudget) {
    warnings.push({
      code: 'TOKEN_BUDGET_EXCEEDED',
      details: { estimatedTokens, tokenBudget: input.tokenBudget },
      message: 'The selected context exceeds the configured token budget.',
    });
  }
  return { estimatedTokens, estimatorId: estimator.id, warnings };
}

function validateTokenBudget(tokenBudget: number | undefined): void {
  if (
    tokenBudget !== undefined &&
    (!Number.isInteger(tokenBudget) || tokenBudget <= 0)
  ) {
    failContext(
      'INVALID_TOKEN_BUDGET',
      'Token budgets must be positive integers',
      {
        tokenBudget,
      },
    );
  }
}

export async function compileContext(
  input: CompileContextInput,
): Promise<CompiledContext> {
  validateGraph(input.graph);
  validateTokenBudget(input.tokenBudget);
  const overrides = input.overrides ?? [];
  validateOverrides(input.graph, overrides);
  const heads = resolveHeads(input.graph, input.heads);
  const firstPair: HeadContextPair = {
    context: collectReachable(input.graph, heads[0]),
    head: heads[0],
  };
  const headContexts: NonEmptyReadonlyArray<HeadContextPair> = [
    firstPair,
    ...heads.slice(1).map((head) => ({
      context: collectReachable(input.graph, head),
      head,
    })),
  ];

  const commonKeys =
    headContexts.length === 1
      ? new Set(firstPair.context.orderedKeys)
      : new Set(
          firstPair.context.orderedKeys.filter((key) =>
            headContexts
              .slice(1)
              .every(({ context }) => context.itemByKey.has(key)),
          ),
        );

  const decisionsByKey = new Map<string, ContextDecision>();
  const selectItems = (
    context: ReachableContext,
    keys: readonly string[],
  ): readonly CompiledContextItem[] =>
    keys.flatMap((key) => {
      const item = context.itemByKey.get(key) as CompiledContextItem;
      const applied = applySelection(item, findSelection(item, overrides));
      decisionsByKey.set(key, applied.decision);
      return applied.item === null ? [] : [applied.item];
    });

  const common = {
    items: selectItems(
      firstPair.context,
      firstPair.context.orderedKeys.filter((key) => commonKeys.has(key)),
    ),
    kind: 'common' as const,
  };

  const branches: readonly BranchContextSegment[] =
    headContexts.length === 1
      ? []
      : headContexts.map(({ context, head }) => {
          return {
            items: selectItems(
              context,
              context.orderedKeys.filter((key) => !commonKeys.has(key)),
            ),
            kind: 'branch',
            label: head.label,
            slot: head.slot,
          };
        });

  const allItems = [
    ...common.items,
    ...branches.flatMap((branch) => branch.items),
  ];
  const estimate = estimateTokens(allItems, input);
  const withoutHash: CompiledContextWithoutHash = {
    branches,
    common,
    decisions: [...decisionsByKey.values()].sort(
      (left, right) =>
        left.nodeId.localeCompare(right.nodeId) ||
        left.revisionId.localeCompare(right.revisionId),
    ),
    estimatedTokens: estimate.estimatedTokens,
    estimatorId: estimate.estimatorId,
    tokenBudget: input.tokenBudget ?? null,
    version: 1,
    warnings: estimate.warnings,
  };

  return {
    ...withoutHash,
    hash: await sha256(canonicalJson(withoutHash)),
  };
}
