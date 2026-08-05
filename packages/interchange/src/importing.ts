import {
  validateGraph,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type JsonValue,
  type NodeRevision,
} from '@waterlily/domain';

import { failInterchange } from './errors.js';
import { parseGraphDocument, validateGraphDocument } from './document.js';
import type {
  GraphDocumentV1,
  GraphViewGroup,
  GraphViewState,
  IdRemapper,
  ImportGraphOptions,
  ImportMapping,
  ImportResult,
  MergeGraphDocumentInput,
} from './types.js';

function sortedIds(
  record: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.keys(record).sort((left, right) => left.localeCompare(right));
}

function buildMap(
  kind: Parameters<IdRemapper>[0],
  ids: readonly string[],
  remapId: IdRemapper,
): Readonly<Record<string, string>> {
  return Object.fromEntries(ids.map((id) => [id, remapId(kind, id)]));
}

function mapped(mapping: Readonly<Record<string, string>>, id: string): string {
  const result = mapping[id];
  if (result === undefined) {
    failInterchange('INVALID_DOCUMENT', 'Import mapping is incomplete', { id });
  }
  return result;
}

function assertUniqueMapping(mapping: ImportMapping): void {
  const ids = [
    ...Object.values(mapping.nodes),
    ...Object.values(mapping.revisions),
    ...Object.values(mapping.edges),
  ];
  if (new Set(ids).size !== ids.length) {
    failInterchange(
      'ID_COLLISION',
      'Remapped graph entity identifiers must be unique',
    );
  }
  const groupIds = Object.values(mapping.groups);
  if (new Set(groupIds).size !== groupIds.length) {
    failInterchange(
      'ID_COLLISION',
      'Remapped group identifiers must be unique',
    );
  }
}

function importMetadata(
  revision: NodeRevision,
  sourceGraphId: string,
): Readonly<Record<string, JsonValue>> {
  return {
    ...structuredClone(revision.metadata),
    $llmGraphImport: {
      sourceGraphId,
      sourceNodeId: revision.nodeId,
      sourceRevisionId: revision.id,
    },
  };
}

function remapView(
  document: GraphDocumentV1,
  mapping: ImportMapping,
): GraphViewState {
  const positions = Object.fromEntries(
    Object.entries(document.view.positions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([nodeId, position]) => [mapped(mapping.nodes, nodeId), position]),
  );
  const groups = document.view.groups.map((group): GraphViewGroup => ({
    ...group,
    id: mapped(mapping.groups, group.id),
    nodeIds: group.nodeIds.map((nodeId) => mapped(mapping.nodes, nodeId)),
  }));
  return { groups, positions };
}

export function cloneGraphDocument(
  document: GraphDocumentV1,
  options: ImportGraphOptions,
): ImportResult {
  document = validateGraphDocument(document);
  const mapping: ImportMapping = {
    edges: buildMap('edge', sortedIds(document.graph.edges), options.remapId),
    graphId: options.graphId ?? options.remapId('graph', document.graph.id),
    groups: buildMap(
      'group',
      document.view.groups
        .map((group) => group.id)
        .sort((left, right) => left.localeCompare(right)),
      options.remapId,
    ),
    nodes: buildMap('node', sortedIds(document.graph.nodes), options.remapId),
    revisions: buildMap(
      'revision',
      sortedIds(document.graph.revisions),
      options.remapId,
    ),
  };
  assertUniqueMapping(mapping);

  const nodes = Object.fromEntries(
    sortedIds(document.graph.nodes).map((id) => {
      const node = document.graph.nodes[id] as GraphNode;
      const remappedId = mapped(mapping.nodes, id);
      return [
        remappedId,
        {
          ...node,
          currentRevisionId: mapped(mapping.revisions, node.currentRevisionId),
          id: remappedId,
        },
      ];
    }),
  );
  const revisions = Object.fromEntries(
    sortedIds(document.graph.revisions).map((id) => {
      const revision = document.graph.revisions[id] as NodeRevision;
      const remappedId = mapped(mapping.revisions, id);
      return [
        remappedId,
        {
          ...revision,
          id: remappedId,
          metadata: importMetadata(revision, document.graph.id),
          nodeId: mapped(mapping.nodes, revision.nodeId),
        },
      ];
    }),
  );
  const edges = Object.fromEntries(
    sortedIds(document.graph.edges).map((id) => {
      const edge = document.graph.edges[id] as GraphEdge;
      const remappedId = mapped(mapping.edges, id);
      return [
        remappedId,
        {
          ...edge,
          id: remappedId,
          ...(edge.kind === 'reference'
            ? {}
            : {
                sourceRevisionId: mapped(
                  mapping.revisions,
                  edge.sourceRevisionId,
                ),
              }),
          sourceNodeId: mapped(mapping.nodes, edge.sourceNodeId),
          targetNodeId: mapped(mapping.nodes, edge.targetNodeId),
        },
      ];
    }),
  );
  const graph: GraphSnapshot = {
    ...document.graph,
    edges,
    id: mapping.graphId,
    nodes,
    revisions,
  };
  validateGraph(graph);
  return { graph, mapping, view: remapView(document, mapping) };
}

export function importGraphDocument(
  text: string,
  options: ImportGraphOptions,
  maxBytes?: number,
): ImportResult {
  const document =
    maxBytes === undefined
      ? parseGraphDocument(text)
      : parseGraphDocument(text, maxBytes);
  return cloneGraphDocument(document, options);
}

function targetEntityIds(graph: GraphSnapshot): Set<string> {
  return new Set([
    ...Object.keys(graph.nodes),
    ...Object.keys(graph.revisions),
    ...Object.keys(graph.edges),
  ]);
}

function targetView(input: MergeGraphDocumentInput): GraphViewState {
  return {
    groups: [...(input.targetView?.groups ?? [])],
    positions: { ...(input.targetView?.positions ?? {}) },
  };
}

export function mergeGraphDocument(
  input: MergeGraphDocumentInput,
): ImportResult {
  validateGraph(input.targetGraph);
  const imported = cloneGraphDocument(input.document, {
    remapId: input.remapId,
  });
  const occupied = targetEntityIds(input.targetGraph);
  const importedIds = [
    ...Object.keys(imported.graph.nodes),
    ...Object.keys(imported.graph.revisions),
    ...Object.keys(imported.graph.edges),
  ];
  const collision = importedIds.find((id) => occupied.has(id));
  if (collision !== undefined) {
    failInterchange(
      'ID_COLLISION',
      'Imported identifier collides with the target graph',
      {
        id: collision,
      },
    );
  }
  const currentView = targetView(input);
  const currentGroupIds = new Set(currentView.groups.map((group) => group.id));
  const groupCollision = imported.view.groups.find((group) =>
    currentGroupIds.has(group.id),
  );
  if (groupCollision !== undefined) {
    failInterchange(
      'ID_COLLISION',
      'Imported group collides with the target view',
      {
        id: groupCollision.id,
      },
    );
  }

  const graph: GraphSnapshot = {
    ...input.targetGraph,
    edges: { ...input.targetGraph.edges, ...imported.graph.edges },
    nodes: { ...input.targetGraph.nodes, ...imported.graph.nodes },
    revisions: { ...input.targetGraph.revisions, ...imported.graph.revisions },
    updatedAt:
      input.targetGraph.updatedAt > imported.graph.updatedAt
        ? input.targetGraph.updatedAt
        : imported.graph.updatedAt,
  };
  validateGraph(graph);
  return {
    graph,
    mapping: imported.mapping,
    view: {
      groups: [...currentView.groups, ...imported.view.groups],
      positions: { ...currentView.positions, ...imported.view.positions },
    },
  };
}
