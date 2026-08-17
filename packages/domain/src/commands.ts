import { fail } from './errors.js';
import {
  type ConnectContextInput,
  type ConnectProvenanceInput,
  type ConnectReferenceInput,
  type ContentBlock,
  type CreateGraphInput,
  type CreateNodeInput,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type JsonValue,
  type NodeRevision,
  type ReviseNodeInput,
  type ReviseTextBlockInput,
  type RemoveTemplateBindingInput,
  type SetTemplateBindingInput,
  type TextContentBlock,
} from './types.js';
import { extractTemplateVariables } from './templates.js';
import { assertId, assertTimestamp, validateGraph } from './validation.js';

function cloneBlocks(blocks: readonly ContentBlock[]): readonly ContentBlock[] {
  return structuredClone(blocks);
}

function cloneMetadata(
  metadata: Readonly<Record<string, JsonValue>> | undefined,
): Readonly<Record<string, JsonValue>> {
  return structuredClone(metadata ?? {});
}

function assertNodeAvailable(graph: GraphSnapshot, nodeId: string): GraphNode {
  const node = graph.nodes[nodeId];
  if (node === undefined) {
    fail('NOT_FOUND', `Node ${nodeId} does not exist`, { nodeId });
  }
  if (node.deletedAt !== null) {
    fail('NODE_DELETED', `Node ${nodeId} has been deleted`, { nodeId });
  }
  return node;
}

function assertNewId(graph: GraphSnapshot, id: string, field: string): void {
  assertId(id, field);
  if (
    graph.nodes[id] !== undefined ||
    graph.revisions[id] !== undefined ||
    graph.edges[id] !== undefined
  ) {
    fail('DUPLICATE_ID', `${field} is already used in this graph`, {
      field,
      id,
    });
  }
}

function withEdge(graph: GraphSnapshot, edge: GraphEdge): GraphSnapshot {
  const next: GraphSnapshot = {
    ...graph,
    edges: { ...graph.edges, [edge.id]: edge },
    updatedAt: edge.createdAt,
  };
  validateGraph(next);
  return next;
}

function resolveSourceRevision(
  graph: GraphSnapshot,
  sourceNode: GraphNode,
  requestedRevisionId: string | undefined,
): string {
  const revisionId = requestedRevisionId ?? sourceNode.currentRevisionId;
  const revision = graph.revisions[revisionId];
  if (revision?.nodeId !== sourceNode.id) {
    fail(
      'INVALID_REVISION',
      'The source revision does not belong to the source node',
      {
        revisionId,
        sourceNodeId: sourceNode.id,
      },
    );
  }
  return revisionId;
}

export function createGraph(input: CreateGraphInput): GraphSnapshot {
  assertId(input.graphId, 'graphId');
  assertTimestamp(input.createdAt, 'createdAt');
  const graph: GraphSnapshot = {
    createdAt: input.createdAt,
    edges: {},
    id: input.graphId,
    nodes: {},
    revisions: {},
    updatedAt: input.createdAt,
    version: 1,
  };
  validateGraph(graph);
  return graph;
}

export function createNode(
  graph: GraphSnapshot,
  input: CreateNodeInput,
): GraphSnapshot {
  validateGraph(graph);
  assertNewId(graph, input.nodeId, 'nodeId');
  assertNewId(graph, input.revisionId, 'revisionId');
  assertTimestamp(input.createdAt, 'createdAt');

  const role = input.role ?? null;
  const revision: NodeRevision = {
    blocks: cloneBlocks(input.blocks),
    createdAt: input.createdAt,
    id: input.revisionId,
    metadata: cloneMetadata(input.metadata),
    nodeId: input.nodeId,
  };
  const node: GraphNode = {
    createdAt: input.createdAt,
    currentRevisionId: input.revisionId,
    deletedAt: null,
    id: input.nodeId,
    kind: input.kind,
    role,
    tags: [...new Set(input.tags ?? [])],
    title: input.title ?? null,
    updatedAt: input.createdAt,
  };
  const next: GraphSnapshot = {
    ...graph,
    nodes: { ...graph.nodes, [node.id]: node },
    revisions: { ...graph.revisions, [revision.id]: revision },
    updatedAt: input.createdAt,
  };
  validateGraph(next);
  return next;
}

export function reviseNode(
  graph: GraphSnapshot,
  input: ReviseNodeInput,
): GraphSnapshot {
  validateGraph(graph);
  const node = assertNodeAvailable(graph, input.nodeId);
  assertNewId(graph, input.revisionId, 'revisionId');
  assertTimestamp(input.createdAt, 'createdAt');

  const revision: NodeRevision = {
    blocks: cloneBlocks(input.blocks),
    createdAt: input.createdAt,
    id: input.revisionId,
    metadata: cloneMetadata(input.metadata),
    nodeId: input.nodeId,
  };
  const revisedNode: GraphNode = {
    ...node,
    currentRevisionId: revision.id,
    updatedAt: input.createdAt,
  };
  const next: GraphSnapshot = {
    ...graph,
    nodes: { ...graph.nodes, [node.id]: revisedNode },
    revisions: { ...graph.revisions, [revision.id]: revision },
    updatedAt: input.createdAt,
  };
  validateGraph(next);
  return next;
}

export function setTemplateBinding(
  graph: GraphSnapshot,
  input: SetTemplateBindingInput,
): GraphSnapshot {
  validateGraph(graph);
  const node = assertNodeAvailable(graph, input.nodeId);
  const current = graph.revisions[node.currentRevisionId] as NodeRevision;
  const source = assertNodeAvailable(graph, input.sourceNodeId);
  const sourceRevisionId = resolveSourceRevision(
    graph,
    source,
    input.sourceRevisionId,
  );
  const sourceRevision = graph.revisions[sourceRevisionId] as NodeRevision;
  const sourceBlockId = input.sourceBlockId ?? null;
  if (
    sourceBlockId !== null &&
    !sourceRevision.blocks.some(
      (block) => block.type === 'text' && block.id === sourceBlockId,
    )
  ) {
    fail('INVALID_CONTENT', 'The binding source block is not text', {
      sourceBlockId,
    });
  }

  const targetBlock = current.blocks.find(
    (block): block is TextContentBlock =>
      block.id === input.targetBlockId && block.type === 'text',
  );
  if (targetBlock === undefined) {
    fail('INVALID_CONTENT', 'The target template block is unavailable', {
      targetBlockId: input.targetBlockId,
    });
  }
  const blocks = current.blocks.map((block): ContentBlock => {
    if (block.id !== input.targetBlockId || block.type !== 'text') return block;
    const variables = extractTemplateVariables(block.text);
    if (!variables.includes(input.name)) {
      fail('INVALID_CONTENT', 'The target template has no matching variable', {
        name: input.name,
        targetBlockId: input.targetBlockId,
      });
    }
    const bindings = [
      ...(block.template?.bindings ?? []).filter(
        (binding) => binding.name !== input.name,
      ),
      {
        name: input.name,
        sourceBlockId,
        sourceNodeId: source.id,
        sourceRevisionId,
      },
    ].sort((left, right) => left.name.localeCompare(right.name));
    return {
      ...block,
      template: { bindings, version: 1 },
    } satisfies TextContentBlock;
  });
  return reviseNode(graph, {
    blocks,
    createdAt: input.createdAt,
    metadata: current.metadata,
    nodeId: input.nodeId,
    revisionId: input.revisionId,
  });
}

function currentRevision(
  graph: GraphSnapshot,
  nodeId: string,
): { readonly node: GraphNode; readonly revision: NodeRevision } {
  const node = assertNodeAvailable(graph, nodeId);
  const revision = graph.revisions[node.currentRevisionId] as NodeRevision;
  return { node, revision };
}

export function reviseTextBlock(
  graph: GraphSnapshot,
  input: ReviseTextBlockInput,
): GraphSnapshot {
  validateGraph(graph);
  const { revision } = currentRevision(graph, input.nodeId);
  const variables = extractTemplateVariables(input.text);
  const targetBlock = revision.blocks.find(
    (block): block is TextContentBlock =>
      block.id === input.blockId && block.type === 'text',
  );
  if (targetBlock === undefined) {
    fail('INVALID_CONTENT', 'The editable text block is unavailable', {
      blockId: input.blockId,
    });
  }
  const blocks = revision.blocks.map((block): ContentBlock => {
    if (block.id !== input.blockId || block.type !== 'text') return block;
    return {
      ...block,
      template: {
        bindings: (block.template?.bindings ?? []).filter((binding) =>
          variables.includes(binding.name),
        ),
        version: 1,
      },
      text: input.text,
    };
  });
  return reviseNode(graph, {
    blocks,
    createdAt: input.createdAt,
    metadata: revision.metadata,
    nodeId: input.nodeId,
    revisionId: input.revisionId,
  });
}

export function removeTemplateBinding(
  graph: GraphSnapshot,
  input: RemoveTemplateBindingInput,
): GraphSnapshot {
  validateGraph(graph);
  const { revision } = currentRevision(graph, input.nodeId);
  const targetBlock = revision.blocks.find(
    (block): block is TextContentBlock =>
      block.id === input.targetBlockId && block.type === 'text',
  );
  if (
    !targetBlock?.template?.bindings.some(
      (binding) => binding.name === input.name,
    )
  ) {
    fail('INVALID_CONTENT', 'The template binding is unavailable', {
      name: input.name,
      targetBlockId: input.targetBlockId,
    });
  }
  const blocks = revision.blocks.map((block): ContentBlock => {
    if (block.id !== input.targetBlockId || block.type !== 'text') return block;
    const bindings = block.template?.bindings ?? [];
    return {
      ...block,
      template: {
        bindings: bindings.filter((binding) => binding.name !== input.name),
        version: 1,
      },
    };
  });
  return reviseNode(graph, {
    blocks,
    createdAt: input.createdAt,
    metadata: revision.metadata,
    nodeId: input.nodeId,
    revisionId: input.revisionId,
  });
}

export function connectContext(
  graph: GraphSnapshot,
  input: ConnectContextInput,
): GraphSnapshot {
  validateGraph(graph);
  assertNewId(graph, input.edgeId, 'edgeId');
  assertTimestamp(input.createdAt, 'createdAt');
  const source = assertNodeAvailable(graph, input.sourceNodeId);
  assertNodeAvailable(graph, input.targetNodeId);
  const sourceRevisionId = resolveSourceRevision(
    graph,
    source,
    input.sourceRevisionId,
  );

  return withEdge(graph, {
    createdAt: input.createdAt,
    id: input.edgeId,
    kind: 'context',
    label: input.label ?? null,
    slot: input.slot,
    sourceNodeId: input.sourceNodeId,
    sourceRevisionId,
    targetNodeId: input.targetNodeId,
  });
}

export function connectProvenance(
  graph: GraphSnapshot,
  input: ConnectProvenanceInput,
): GraphSnapshot {
  validateGraph(graph);
  assertNewId(graph, input.edgeId, 'edgeId');
  assertTimestamp(input.createdAt, 'createdAt');
  const source = assertNodeAvailable(graph, input.sourceNodeId);
  assertNodeAvailable(graph, input.targetNodeId);
  const sourceRevisionId = resolveSourceRevision(
    graph,
    source,
    input.sourceRevisionId,
  );

  return withEdge(graph, {
    createdAt: input.createdAt,
    id: input.edgeId,
    kind: 'provenance',
    relation: input.relation,
    sourceNodeId: input.sourceNodeId,
    sourceRevisionId,
    targetNodeId: input.targetNodeId,
  });
}

export function connectReference(
  graph: GraphSnapshot,
  input: ConnectReferenceInput,
): GraphSnapshot {
  validateGraph(graph);
  assertNewId(graph, input.edgeId, 'edgeId');
  assertTimestamp(input.createdAt, 'createdAt');
  assertNodeAvailable(graph, input.sourceNodeId);
  assertNodeAvailable(graph, input.targetNodeId);

  return withEdge(graph, {
    createdAt: input.createdAt,
    id: input.edgeId,
    kind: 'reference',
    label: input.label ?? null,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
  });
}
