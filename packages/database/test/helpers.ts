import { expect } from 'vitest';

import {
  connectContext,
  connectProvenance,
  connectReference,
  createGraph,
  createNode,
  reviseNode,
  type GraphSnapshot,
  type MessageRole,
} from '@llm-graph/domain';

import { DatabaseError, type DatabaseErrorCode } from '../src/index.js';

export const T0 = '2026-08-05T00:00:00.000Z';

export function timestamp(offsetMilliseconds: number): string {
  return new Date(Date.parse(T0) + offsetMilliseconds).toISOString();
}

export function addMessage(
  graph: GraphSnapshot,
  id: string,
  offset: number,
  role: MessageRole,
  text: string,
): GraphSnapshot {
  return createNode(graph, {
    blocks: [{ format: 'markdown', id: `${id}-block`, text, type: 'text' }],
    createdAt: timestamp(offset),
    kind: 'message',
    metadata: { source: 'test' },
    nodeId: id,
    revisionId: `${id}-revision-1`,
    role,
    tags: ['fixture'],
    title: `${id} title`,
  });
}

export function sampleGraph(
  graphId = 'graph-1',
  idPrefix = graphId,
): GraphSnapshot {
  let graph = createGraph({ createdAt: T0, graphId });
  const question = `${idPrefix}-question`;
  const answer = `${idPrefix}-answer`;
  const excerpt = `${idPrefix}-excerpt`;

  graph = addMessage(graph, question, 1, 'user', 'What is a graph?');
  graph = addMessage(
    graph,
    answer,
    2,
    'assistant',
    'A graph has nodes and edges.',
  );
  graph = createNode(graph, {
    blocks: [
      {
        format: 'markdown',
        id: `${excerpt}-block`,
        text: 'nodes and edges',
        type: 'text',
      },
    ],
    createdAt: timestamp(3),
    kind: 'excerpt',
    metadata: {
      offsets: [12, 27],
      quoteHash: 'abc123',
      sourceRevisionId: `${answer}-revision-1`,
    },
    nodeId: excerpt,
    revisionId: `${excerpt}-revision-1`,
    tags: ['important'],
    title: 'Core definition',
  });
  graph = connectContext(graph, {
    createdAt: timestamp(4),
    edgeId: `${idPrefix}-context`,
    label: 'Main',
    slot: 0,
    sourceNodeId: question,
    targetNodeId: answer,
  });
  graph = connectProvenance(graph, {
    createdAt: timestamp(5),
    edgeId: `${idPrefix}-provenance`,
    relation: 'excerpted',
    sourceNodeId: answer,
    targetNodeId: excerpt,
  });
  graph = connectReference(graph, {
    createdAt: timestamp(6),
    edgeId: `${idPrefix}-reference`,
    label: 'Review later',
    sourceNodeId: question,
    targetNodeId: excerpt,
  });
  return reviseNode(graph, {
    blocks: [
      {
        format: 'markdown',
        id: `${question}-block-v2`,
        text: 'What is a directed graph?',
        type: 'text',
      },
    ],
    createdAt: timestamp(7),
    metadata: { editedAsBranchCandidate: true },
    nodeId: question,
    revisionId: `${question}-revision-2`,
  });
}

export function expectDatabaseError(
  operation: () => unknown,
  code: DatabaseErrorCode,
): DatabaseError {
  try {
    operation();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DatabaseError);
    const databaseError = error as DatabaseError;
    expect(databaseError.code).toBe(code);
    return databaseError;
  }
  throw new Error(`Expected DatabaseError with code ${code}`);
}
