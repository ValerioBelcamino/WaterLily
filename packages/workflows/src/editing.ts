import {
  connectContext,
  connectProvenance,
  createNode,
  validateGraph,
  type ContextEdge,
  type GraphSnapshot,
  type NodeRevision,
  type TextContentBlock,
} from '@waterlily/domain';

import { failWorkflow } from './errors.js';
import type {
  BranchInput,
  MergeInput,
  NewMessageNode,
  SplitInput,
  SplitResult,
} from './types.js';

function addUserMessage(
  graph: GraphSnapshot,
  message: NewMessageNode,
): GraphSnapshot {
  return createNode(graph, {
    blocks: [
      {
        format: 'markdown',
        id: message.blockId,
        text: message.text,
        type: 'text',
      },
    ],
    createdAt: message.createdAt,
    kind: 'message',
    nodeId: message.nodeId,
    revisionId: message.revisionId,
    role: 'user',
    title: message.title ?? null,
  });
}

export function branchFromNode(input: BranchInput): GraphSnapshot {
  const withMessage = addUserMessage(input.graph, input.message);
  return connectContext(withMessage, {
    createdAt: input.message.createdAt,
    edgeId: input.edgeId,
    slot: 0,
    sourceNodeId: input.parentNodeId,
    ...(input.parentRevisionId === undefined
      ? {}
      : { sourceRevisionId: input.parentRevisionId }),
    targetNodeId: input.message.nodeId,
  });
}

export function mergeBranches(input: MergeInput): GraphSnapshot {
  if (input.heads.length < 2) {
    failWorkflow('INVALID_OPERATION', 'A merge requires at least two heads');
  }
  if (input.edgeIds.length !== input.heads.length) {
    failWorkflow(
      'INVALID_OPERATION',
      'A merge requires one context edge id for every head',
      { edgeIds: input.edgeIds.length, heads: input.heads.length },
    );
  }
  if (
    new Set(input.heads.map((head) => head.nodeId)).size !== input.heads.length
  ) {
    failWorkflow('INVALID_OPERATION', 'Merge heads must be distinct');
  }

  let graph = addUserMessage(input.graph, input.message);
  input.heads.forEach((head, slot) => {
    const edgeId = input.edgeIds[slot] as string;
    graph = connectContext(graph, {
      createdAt: input.message.createdAt,
      edgeId,
      label: head.label ?? null,
      slot,
      sourceNodeId: head.nodeId,
      ...(head.revisionId === undefined
        ? {}
        : { sourceRevisionId: head.revisionId }),
      targetNodeId: input.message.nodeId,
    });
  });
  return graph;
}

function sourceRevision(input: SplitInput): NodeRevision {
  const sourceNode = input.graph.nodes[input.sourceNodeId];
  if (sourceNode?.deletedAt !== null) {
    failWorkflow('INVALID_OPERATION', 'The split source node is unavailable', {
      nodeId: input.sourceNodeId,
    });
  }
  const revisionId = input.sourceRevisionId ?? sourceNode.currentRevisionId;
  const revision = input.graph.revisions[revisionId];
  if (revision?.nodeId !== sourceNode.id) {
    failWorkflow(
      'INVALID_OPERATION',
      'The split revision does not belong to its node',
      {
        nodeId: sourceNode.id,
        revisionId,
      },
    );
  }
  return revision;
}

export function splitNode(input: SplitInput): SplitResult {
  validateGraph(input.graph);
  const source = sourceRevision(input);
  if (input.parts.length < 2) {
    failWorkflow('INVALID_OPERATION', 'A split requires at least two parts');
  }
  const sourceBlockIds = new Set(source.blocks.map((block) => block.id));
  const incomingContext = Object.values(input.graph.edges)
    .filter(
      (edge): edge is ContextEdge =>
        edge.kind === 'context' && edge.targetNodeId === input.sourceNodeId,
    )
    .sort((left, right) => left.slot - right.slot);
  let graph = input.graph;
  const nodeIds: string[] = [];

  input.parts.forEach((part, splitIndex) => {
    if (
      part.sourceBlockIds.length === 0 ||
      new Set(part.sourceBlockIds).size !== part.sourceBlockIds.length ||
      part.sourceBlockIds.some((blockId) => !sourceBlockIds.has(blockId))
    ) {
      failWorkflow(
        'INVALID_OPERATION',
        'Every split part must cite blocks from the source revision',
        { splitIndex },
      );
    }
    if (part.contextEdgeIds.length !== incomingContext.length) {
      failWorkflow(
        'INVALID_OPERATION',
        'Every split part requires one edge id for each inherited context edge',
        { splitIndex },
      );
    }
    const citedText = part.sourceBlockIds
      .map((blockId) => source.blocks.find((block) => block.id === blockId))
      .filter((block): block is TextContentBlock => block?.type === 'text')
      .map((block) => block.text)
      .join('\n\n');
    if (part.text.trim().length === 0 || !citedText.includes(part.text)) {
      failWorkflow(
        'INVALID_OPERATION',
        'Split excerpts must be verbatim content from their cited source blocks',
        { splitIndex },
      );
    }
    graph = createNode(graph, {
      blocks: [
        {
          format: 'markdown',
          id: part.blockId,
          text: part.text,
          type: 'text',
        },
      ],
      createdAt: input.createdAt,
      kind: 'excerpt',
      metadata: {
        sourceBlockIds: part.sourceBlockIds,
        splitIndex,
      },
      nodeId: part.nodeId,
      revisionId: part.revisionId,
      title: part.title ?? null,
    });
    graph = connectProvenance(graph, {
      createdAt: input.createdAt,
      edgeId: part.provenanceEdgeId,
      relation: 'excerpted',
      sourceNodeId: input.sourceNodeId,
      sourceRevisionId: source.id,
      targetNodeId: part.nodeId,
    });
    incomingContext.forEach((edge, contextIndex) => {
      graph = connectContext(graph, {
        createdAt: input.createdAt,
        edgeId: part.contextEdgeIds[contextIndex] as string,
        label: edge.label,
        slot: edge.slot,
        sourceNodeId: edge.sourceNodeId,
        sourceRevisionId: edge.sourceRevisionId,
        targetNodeId: part.nodeId,
      });
    });
    nodeIds.push(part.nodeId);
  });

  return { graph, nodeIds };
}
