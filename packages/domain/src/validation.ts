import { fail } from './errors.js';
import {
  EDGE_KINDS,
  MESSAGE_ROLES,
  NODE_KINDS,
  type ContentBlock,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type JsonValue,
  type NodeRevision,
} from './types.js';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function assertId(value: string, field: string): void {
  if (!idPattern.test(value)) {
    fail('INVALID_ID', `${field} must be a non-empty portable identifier`, {
      field,
      value,
    });
  }
}

export function assertTimestamp(value: string, field: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    fail('INVALID_TIMESTAMP', `${field} must be a canonical ISO-8601 instant`, {
      field,
      value,
    });
  }
}

function assertJsonValue(value: JsonValue, path: string): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('INVALID_CONTENT', `${path} contains a non-finite number`, { path });
    }
    return;
  }

  if (Array.isArray(value)) {
    (value as readonly JsonValue[]).forEach((item, index) => {
      assertJsonValue(item, `${path}[${String(index)}]`);
    });
    return;
  }

  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`);
    }
    return;
  }

  fail('INVALID_CONTENT', `${path} is not JSON-compatible`, { path });
}

function assertContentBlocks(
  blocks: readonly ContentBlock[],
  path: string,
): void {
  const ids = new Set<string>();

  for (const [index, block] of blocks.entries()) {
    const blockPath = `${path}[${String(index)}]`;
    assertId(block.id, `${blockPath}.id`);
    if (ids.has(block.id)) {
      fail('INVALID_CONTENT', `${path} contains duplicate block identifiers`, {
        blockId: block.id,
        path,
      });
    }
    ids.add(block.id);

    if (block.type === 'text') {
      if (!isTextFormat(block.format)) {
        fail('INVALID_CONTENT', `${blockPath}.format is unsupported`, {
          format: block.format,
        });
      }
      continue;
    }

    assertId(block.attachmentId, `${blockPath}.attachmentId`);
    if (block.mediaType.trim().length === 0) {
      fail('INVALID_CONTENT', `${blockPath}.mediaType cannot be blank`, {
        path: blockPath,
      });
    }
  }
}

function assertNode(node: GraphNode, graph: GraphSnapshot): void {
  assertId(node.id, 'node.id');
  assertId(node.currentRevisionId, 'node.currentRevisionId');
  assertTimestamp(node.createdAt, 'node.createdAt');
  assertTimestamp(node.updatedAt, 'node.updatedAt');
  if (node.deletedAt !== null) {
    assertTimestamp(node.deletedAt, 'node.deletedAt');
  }

  if (!NODE_KINDS.includes(node.kind)) {
    fail('INVALID_NODE', `Node ${node.id} has an unsupported kind`, {
      kind: node.kind,
      nodeId: node.id,
    });
  }

  if (node.kind === 'message') {
    if (node.role === null || !MESSAGE_ROLES.includes(node.role)) {
      fail('INVALID_NODE', `Message node ${node.id} requires a valid role`, {
        nodeId: node.id,
        role: node.role,
      });
    }
  } else if (node.role !== null) {
    fail('INVALID_NODE', `Non-message node ${node.id} cannot have a role`, {
      nodeId: node.id,
      role: node.role,
    });
  }

  const currentRevision = graph.revisions[node.currentRevisionId];
  if (currentRevision?.nodeId !== node.id) {
    fail('INVALID_NODE', `Node ${node.id} has an invalid current revision`, {
      nodeId: node.id,
      revisionId: node.currentRevisionId,
    });
  }

  const tagSet = new Set(node.tags);
  if (tagSet.size !== node.tags.length || node.tags.some((tag) => tag === '')) {
    fail('INVALID_NODE', `Node ${node.id} has invalid tags`, {
      nodeId: node.id,
      tags: node.tags,
    });
  }
}

function assertRevision(revision: NodeRevision, graph: GraphSnapshot): void {
  assertId(revision.id, 'revision.id');
  assertId(revision.nodeId, 'revision.nodeId');
  assertTimestamp(revision.createdAt, 'revision.createdAt');
  if (graph.nodes[revision.nodeId] === undefined) {
    fail('INVALID_REVISION', `Revision ${revision.id} has no owning node`, {
      nodeId: revision.nodeId,
      revisionId: revision.id,
    });
  }
  assertContentBlocks(revision.blocks, `revision.${revision.id}.blocks`);
  assertJsonValue(revision.metadata, `revision.${revision.id}.metadata`);
}

function edgeDuplicateKey(edge: GraphEdge): string {
  const revision = edge.kind === 'reference' ? '' : edge.sourceRevisionId;
  return [edge.kind, edge.sourceNodeId, revision, edge.targetNodeId].join(
    '\u0000',
  );
}

function assertEdgeReferences(edge: GraphEdge, graph: GraphSnapshot): void {
  assertId(edge.id, 'edge.id');
  assertId(edge.sourceNodeId, 'edge.sourceNodeId');
  assertId(edge.targetNodeId, 'edge.targetNodeId');
  assertTimestamp(edge.createdAt, 'edge.createdAt');

  if (!EDGE_KINDS.includes(edge.kind)) {
    fail('INVALID_EDGE', `Edge ${edge.id} has an unsupported kind`, {
      edgeId: edge.id,
      kind: edge.kind,
    });
  }
  if (edge.sourceNodeId === edge.targetNodeId) {
    fail('SELF_EDGE', `Edge ${edge.id} cannot connect a node to itself`, {
      edgeId: edge.id,
      nodeId: edge.sourceNodeId,
    });
  }

  const source = graph.nodes[edge.sourceNodeId];
  const target = graph.nodes[edge.targetNodeId];
  if (!(source && target)) {
    fail('NOT_FOUND', `Edge ${edge.id} references a missing node`, {
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
    });
  }

  if (edge.kind !== 'reference') {
    const revision = graph.revisions[edge.sourceRevisionId];
    if (revision?.nodeId !== edge.sourceNodeId) {
      fail('INVALID_EDGE', `Edge ${edge.id} pins an invalid source revision`, {
        edgeId: edge.id,
        sourceNodeId: edge.sourceNodeId,
        sourceRevisionId: edge.sourceRevisionId,
      });
    }
  }

  if (
    edge.kind === 'context' &&
    (!Number.isInteger(edge.slot) || edge.slot < 0)
  ) {
    fail(
      'INVALID_EDGE',
      `Context edge ${edge.id} requires a non-negative slot`,
      {
        edgeId: edge.id,
        slot: edge.slot,
      },
    );
  }
}

function assertNoCausalCycle(graph: GraphSnapshot): void {
  const adjacency = new Map<string, string[]>();
  for (const nodeId of Object.keys(graph.nodes)) {
    adjacency.set(nodeId, []);
  }
  for (const edge of Object.values(graph.edges)) {
    if (edge.kind !== 'reference') {
      adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      fail('CAUSAL_CYCLE', 'The causal graph contains a cycle', { nodeId });
    }
    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);
    for (const targetId of adjacency.get(nodeId) ?? []) {
      visit(targetId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of Object.keys(graph.nodes)) {
    visit(nodeId);
  }
}

function isTextFormat(value: unknown): value is 'markdown' | 'plain' {
  return value === 'markdown' || value === 'plain';
}

function isSupportedGraphVersion(value: number): value is 1 {
  return value === 1;
}

export function validateGraph(graph: GraphSnapshot): void {
  assertId(graph.id, 'graph.id');
  assertTimestamp(graph.createdAt, 'graph.createdAt');
  assertTimestamp(graph.updatedAt, 'graph.updatedAt');
  if (!isSupportedGraphVersion(graph.version)) {
    fail('INVALID_GRAPH', 'Unsupported graph snapshot version', {
      version: graph.version,
    });
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (nodeId !== node.id) {
      fail('INVALID_GRAPH', 'Node record key does not match node identifier', {
        key: nodeId,
        nodeId: node.id,
      });
    }
  }
  for (const [revisionId, revision] of Object.entries(graph.revisions)) {
    if (revisionId !== revision.id) {
      fail(
        'INVALID_GRAPH',
        'Revision record key does not match revision identifier',
        { key: revisionId, revisionId: revision.id },
      );
    }
    assertRevision(revision, graph);
  }
  for (const node of Object.values(graph.nodes)) {
    assertNode(node, graph);
  }

  const duplicateKeys = new Set<string>();
  const incomingSlots = new Set<string>();
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edgeId !== edge.id) {
      fail('INVALID_GRAPH', 'Edge record key does not match edge identifier', {
        edgeId: edge.id,
        key: edgeId,
      });
    }
    assertEdgeReferences(edge, graph);

    const duplicateKey = edgeDuplicateKey(edge);
    if (duplicateKeys.has(duplicateKey)) {
      fail('DUPLICATE_EDGE', `Edge ${edge.id} duplicates an existing edge`, {
        edgeId: edge.id,
      });
    }
    duplicateKeys.add(duplicateKey);

    if (edge.kind === 'context') {
      const slotKey = `${edge.targetNodeId}\u0000${String(edge.slot)}`;
      if (incomingSlots.has(slotKey)) {
        fail(
          'DUPLICATE_SLOT',
          `Target ${edge.targetNodeId} has duplicate context slot ${String(edge.slot)}`,
          { slot: edge.slot, targetNodeId: edge.targetNodeId },
        );
      }
      incomingSlots.add(slotKey);
    }
  }

  assertNoCausalCycle(graph);
}
