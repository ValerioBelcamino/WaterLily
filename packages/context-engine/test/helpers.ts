import { expect } from 'vitest';

import {
  connectContext,
  createGraph,
  createNode,
  type ContentBlock,
  type GraphSnapshot,
  type MessageRole,
  type NodeKind,
} from '@llm-graph/domain';

import { ContextCompilerError, type ContextErrorCode } from '../src/index.js';

export const T0 = '2026-08-05T00:00:00.000Z';

export function timestamp(offsetMilliseconds: number): string {
  return new Date(Date.parse(T0) + offsetMilliseconds).toISOString();
}

export function emptyGraph(): GraphSnapshot {
  return createGraph({ createdAt: T0, graphId: 'graph-1' });
}

export function addNode(
  graph: GraphSnapshot,
  input: {
    readonly blocks?: readonly ContentBlock[];
    readonly id: string;
    readonly kind?: NodeKind;
    readonly offset: number;
    readonly role?: MessageRole | null;
    readonly text?: string;
  },
): GraphSnapshot {
  const kind = input.kind ?? 'message';
  return createNode(graph, {
    blocks: input.blocks ?? [
      textBlock(`${input.id}-block`, input.text ?? input.id),
    ],
    createdAt: timestamp(input.offset),
    kind,
    nodeId: input.id,
    revisionId: `${input.id}-revision-1`,
    role: kind === 'message' ? (input.role ?? 'user') : null,
  });
}

export function textBlock(id: string, text: string): ContentBlock {
  return { format: 'markdown', id, text, type: 'text' };
}

export function connect(
  graph: GraphSnapshot,
  sourceNodeId: string,
  targetNodeId: string,
  slot: number,
  offset: number,
): GraphSnapshot {
  return connectContext(graph, {
    createdAt: timestamp(offset),
    edgeId: `edge-${sourceNodeId}-${targetNodeId}`,
    slot,
    sourceNodeId,
    targetNodeId,
  });
}

export function expectContextError(
  operation: () => unknown,
  code: ContextErrorCode,
): ContextCompilerError {
  try {
    operation();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ContextCompilerError);
    const compilerError = error as ContextCompilerError;
    expect(compilerError.code).toBe(code);
    return compilerError;
  }
  throw new Error(`Expected ContextCompilerError with code ${code}`);
}

export async function expectContextErrorAsync(
  operation: () => Promise<unknown>,
  code: ContextErrorCode,
): Promise<ContextCompilerError> {
  try {
    await operation();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ContextCompilerError);
    const compilerError = error as ContextCompilerError;
    expect(compilerError.code).toBe(code);
    return compilerError;
  }
  throw new Error(`Expected ContextCompilerError with code ${code}`);
}
