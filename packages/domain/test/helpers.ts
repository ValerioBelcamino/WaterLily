import { expect } from 'vitest';

import {
  GraphDomainError,
  createGraph,
  createNode,
  type GraphErrorCode,
  type GraphSnapshot,
  type MessageRole,
} from '../src/index.js';

export const T0 = '2026-08-05T00:00:00.000Z';

export function timestamp(offsetMilliseconds: number): string {
  return new Date(Date.parse(T0) + offsetMilliseconds).toISOString();
}

export function emptyGraph(): GraphSnapshot {
  return createGraph({ createdAt: T0, graphId: 'graph-1' });
}

export function addMessage(
  graph: GraphSnapshot,
  id: string,
  offset: number,
  role: MessageRole = 'user',
  text = id,
): GraphSnapshot {
  return createNode(graph, {
    blocks: [{ format: 'markdown', id: `${id}-block`, text, type: 'text' }],
    createdAt: timestamp(offset),
    kind: 'message',
    nodeId: id,
    revisionId: `${id}-revision-1`,
    role,
  });
}

export function expectGraphError(
  operation: () => unknown,
  code: GraphErrorCode,
): GraphDomainError {
  try {
    operation();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GraphDomainError);
    const graphError = error as GraphDomainError;
    expect(graphError.code).toBe(code);
    return graphError;
  }
  throw new Error(`Expected GraphDomainError with code ${code}`);
}
