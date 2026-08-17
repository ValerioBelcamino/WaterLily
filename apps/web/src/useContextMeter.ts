import type { ModelDescriptor } from '@waterlily/api-contract';
import {
  approximateTextTokenEstimator,
  compileContext,
  type ContextOverride,
  type ContextSelection,
} from '@waterlily/context-engine';
import type { GraphSnapshot } from '@waterlily/domain';
import { useEffect, useState } from 'react';

import { nodeTitle } from './graph/graphViewModel';

export const DEFAULT_OUTPUT_RESERVE_TOKENS = 8_192;

export interface ContextTokenBreakdown {
  readonly nodeId: string;
  readonly title: string;
  readonly tokens: number;
}

export interface ContextMeterState {
  readonly attachmentCount: number;
  readonly breakdown: readonly ContextTokenBreakdown[];
  readonly budgetTokens: number | null;
  readonly contextWindowTokens: number | null;
  readonly error: string | null;
  readonly estimatedTokens: number | null;
  readonly outputReserveTokens: number;
  readonly overflow: boolean;
  readonly status: 'estimating' | 'idle' | 'ready';
}

const IDLE_METER: ContextMeterState = {
  attachmentCount: 0,
  breakdown: [],
  budgetTokens: null,
  contextWindowTokens: null,
  error: null,
  estimatedTokens: null,
  outputReserveTokens: DEFAULT_OUTPUT_RESERVE_TOKENS,
  overflow: false,
  status: 'idle',
};

function parseGeneratedJson(source: string): unknown {
  const parsed: unknown = JSON.parse(source);
  return parsed;
}

export function useContextMeter(
  graph: GraphSnapshot,
  headNodeIds: readonly string[],
  contextSelections: Readonly<Record<string, ContextSelection>>,
  model: ModelDescriptor | null,
): ContextMeterState {
  const headNodeIdsJson = JSON.stringify(headNodeIds);
  const overridesJson = JSON.stringify(
    Object.entries(contextSelections).map(([nodeId, selection]) => ({
      nodeId,
      selection,
    })),
  );
  const contextWindowTokens = model?.contextWindowTokens ?? null;
  const outputReserveTokens = Math.min(
    DEFAULT_OUTPUT_RESERVE_TOKENS,
    model?.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS,
  );
  const budgetTokens =
    contextWindowTokens === null
      ? null
      : Math.max(1, contextWindowTokens - outputReserveTokens);
  const requestKey = JSON.stringify({
    budgetTokens,
    graphId: graph.id,
    graphUpdatedAt: graph.updatedAt,
    headNodeIdsJson,
    outputReserveTokens,
    overridesJson,
  });
  const [resolved, setResolved] = useState<{
    readonly key: string;
    readonly state: ContextMeterState;
  } | null>(null);

  useEffect(() => {
    if (headNodeIds.length === 0) return;
    let current = true;
    const stableHeadNodeIds = parseGeneratedJson(
      headNodeIdsJson,
    ) as readonly string[];
    const overrides = parseGeneratedJson(
      overridesJson,
    ) as readonly ContextOverride[];
    void compileContext({
      graph,
      heads: stableHeadNodeIds.map((nodeId, slot) => ({
        label: nodeTitle(graph, nodeId),
        nodeId,
        slot,
      })),
      overrides,
      tokenEstimator: approximateTextTokenEstimator,
    }).then(
      (compiled) => {
        if (!current) return;
        const items = [
          ...compiled.common.items,
          ...compiled.branches.flatMap((branch) => branch.items),
        ];
        const overhead = items.length * 4 + compiled.branches.length * 8;
        const breakdown = items.map((item) => ({
          nodeId: item.nodeId,
          title: item.title ?? nodeTitle(graph, item.nodeId),
          tokens: approximateTextTokenEstimator.estimate(item.blocks) + 4,
        }));
        const estimatedTokens = (compiled.estimatedTokens ?? 0) + overhead;
        setResolved({
          key: requestKey,
          state: {
            attachmentCount: items.reduce(
              (count, item) =>
                count +
                item.blocks.filter((block) => block.type === 'attachment')
                  .length,
              0,
            ),
            breakdown,
            budgetTokens,
            contextWindowTokens,
            error: null,
            estimatedTokens,
            outputReserveTokens,
            overflow: budgetTokens !== null && estimatedTokens > budgetTokens,
            status: 'ready',
          },
        });
      },
      (cause: unknown) => {
        if (!current) return;
        setResolved({
          key: requestKey,
          state: {
            ...IDLE_METER,
            budgetTokens,
            contextWindowTokens,
            error:
              cause instanceof Error
                ? cause.message
                : 'Context could not be estimated.',
            outputReserveTokens,
            status: 'ready',
          },
        });
      },
    );
    return () => {
      current = false;
    };
  }, [
    budgetTokens,
    contextWindowTokens,
    graph,
    headNodeIds.length,
    headNodeIdsJson,
    outputReserveTokens,
    overridesJson,
    requestKey,
  ]);

  if (headNodeIds.length === 0) return IDLE_METER;
  if (resolved?.key === requestKey) return resolved.state;
  return {
    ...IDLE_METER,
    budgetTokens,
    contextWindowTokens,
    outputReserveTokens,
    status: 'estimating',
  };
}
