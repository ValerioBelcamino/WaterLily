import type {
  ContextEdge,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  MessageRole,
} from '@waterlily/domain';
import type { GraphViewGroup, GraphViewState } from '@waterlily/interchange';
import {
  compileContext,
  type ContextHead,
  type ContextSelection,
} from '@waterlily/context-engine';
import { MarkerType, type Edge, type Node } from '@xyflow/react';

import type { AttachmentCompatibility } from '../files/compatibility';

export interface CanvasPosition {
  readonly x: number;
  readonly y: number;
}

export type CanvasPositions = Readonly<Record<string, CanvasPosition>>;

export interface ActiveContextFlow {
  readonly edgeIds: readonly string[];
  readonly mode: 'preview' | 'running';
  readonly nodeIds: readonly string[];
}

export type ContextFlowState = 'active' | 'idle' | 'inactive';

export interface ConversationNodeData extends Record<string, unknown> {
  readonly attachmentCompatibility: AttachmentCompatibility | null;
  readonly contextMode: ContextSelection['mode'];
  readonly flowMode: ActiveContextFlow['mode'] | null;
  readonly flowState: ContextFlowState;
  readonly kind: string;
  readonly preview: string;
  readonly role: MessageRole | null;
  readonly title: string;
}

export type ConversationFlowNode = Node<ConversationNodeData, 'conversation'>;

export interface GroupNodeData extends Record<string, unknown> {
  readonly color: string;
  readonly memberNodeIds: readonly string[];
  readonly origin: CanvasPosition;
  readonly title: string;
}

export type GroupFlowNode = Node<GroupNodeData, 'canvasGroup'>;
export type WaterLilyFlowNode = ConversationFlowNode | GroupFlowNode;

export interface FlowProjectionOptions {
  readonly activeFlow?: ActiveContextFlow | null;
  readonly attachmentCompatibility?: Readonly<
    Record<string, AttachmentCompatibility>
  >;
  readonly contextSelections?: Readonly<Record<string, ContextSelection>>;
  readonly groups?: readonly GraphViewGroup[];
  readonly positions?: GraphViewState['positions'];
  readonly selectedNodeIds?: readonly string[];
}

const NODE_WIDTH = 246;
const NODE_HEIGHT_ESTIMATE = 150;
const GROUP_PADDING_X = 30;
const GROUP_PADDING_TOP = 48;
const GROUP_PADDING_BOTTOM = 28;

const ROLE_LABELS: Readonly<Record<MessageRole, string>> = {
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
  user: 'You',
};

const edgePresentation: Readonly<
  Record<
    GraphEdge['kind'],
    {
      readonly color: string;
      readonly dash?: string;
    }
  >
> = {
  context: {
    color: '#547a68',
  },
  provenance: {
    color: '#b06b3e',
    dash: '7 6',
  },
  reference: {
    color: '#7669a8',
    dash: '2 7',
  },
};

function edgeLabel(edge: GraphEdge): string {
  switch (edge.kind) {
    case 'context':
      return edge.label ?? 'context';
    case 'provenance':
      return edge.relation;
    case 'reference':
      return edge.label ?? 'reference';
  }
}

function orderedNodeIds(graph: GraphSnapshot): readonly string[] {
  return Object.values(graph.nodes)
    .filter((node) => node.deletedAt === null)
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    )
    .map((node) => node.id);
}

export function deriveDefaultPositions(
  graph: GraphSnapshot,
): Readonly<Record<string, CanvasPosition>> {
  const ids = orderedNodeIds(graph);
  const depth = new Map(ids.map((id) => [id, 0]));
  const contextEdges = Object.values(graph.edges)
    .filter((edge) => edge.kind === 'context')
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    );

  let pass = 0;
  while (pass < ids.length) {
    let changed = false;
    for (const edge of contextEdges) {
      const sourceDepth = depth.get(edge.sourceNodeId) as number;
      const targetDepth = depth.get(edge.targetNodeId) as number;
      const candidate = sourceDepth + 1;
      if (candidate > targetDepth) {
        depth.set(edge.targetNodeId, candidate);
        changed = true;
      }
    }
    if (!changed) break;
    pass += 1;
  }

  const rowsByDepth = new Map<number, number>();
  return Object.fromEntries(
    ids.map((id) => {
      const column = depth.get(id) as number;
      const row = rowsByDepth.get(column) ?? 0;
      rowsByDepth.set(column, row + 1);
      return [id, { x: column * 330, y: row * 210 }];
    }),
  );
}

export function revisionText(graph: GraphSnapshot, nodeId: string): string {
  const node = graph.nodes[nodeId];
  if (node === undefined) return '';
  const revision = graph.revisions[node.currentRevisionId];
  if (revision === undefined) return '';

  return revision.blocks
    .map((block) =>
      block.type === 'text'
        ? block.text
        : block.name === null
          ? `[Attachment: ${block.mediaType}]`
          : `[Attachment: ${block.name}]`,
    )
    .join('\n\n');
}

export function nodeTitle(graph: GraphSnapshot, nodeId: string): string {
  const node = graph.nodes[nodeId];
  if (node === undefined) return 'Unknown node';
  if (node.title !== null) return node.title;
  if (node.role !== null) return `${ROLE_LABELS[node.role]} message`;
  return `${node.kind.charAt(0).toUpperCase()}${node.kind.slice(1)}`;
}

export async function deriveActiveContextFlow(
  graph: GraphSnapshot,
  heads: readonly ContextHead[],
  contextSelections: Readonly<Record<string, ContextSelection>> = {},
  mode: ActiveContextFlow['mode'] = 'preview',
): Promise<ActiveContextFlow> {
  const compiled = await compileContext({
    graph,
    heads,
    overrides: Object.entries(contextSelections).map(([nodeId, selection]) => ({
      nodeId,
      selection,
    })),
  });
  const activeNodeIds = new Set(
    compiled.decisions
      .filter((decision) => decision.mode !== 'excluded')
      .map((decision) => decision.nodeId),
  );
  const nodeIds = [...activeNodeIds].sort((left, right) =>
    left.localeCompare(right),
  );
  const edgeIds = Object.values(graph.edges)
    .filter(
      (edge) =>
        edge.kind === 'context' &&
        activeNodeIds.has(edge.sourceNodeId) &&
        activeNodeIds.has(edge.targetNodeId),
    )
    .map((edge) => edge.id)
    .sort((left, right) => left.localeCompare(right));
  return { edgeIds, mode, nodeIds };
}

export function toFlowNodes(
  graph: GraphSnapshot,
  options: FlowProjectionOptions = {},
): WaterLilyFlowNode[] {
  const positions = options.positions ?? {};
  const selectedNodeIds = new Set(options.selectedNodeIds ?? []);
  const activeNodeIds = new Set(options.activeFlow?.nodeIds ?? []);
  const hasActiveFlow =
    options.activeFlow !== null && options.activeFlow !== undefined;
  const groups = options.groups ?? [];
  const defaults = deriveDefaultPositions(graph);
  const absolutePositions: CanvasPositions = Object.fromEntries(
    orderedNodeIds(graph).map((id) => [
      id,
      (positions[id] ?? defaults[id]) as CanvasPosition,
    ]),
  );
  const groupByNode = new Map<string, GraphViewGroup>();
  const groupNodes = groups.flatMap((group): GroupFlowNode[] => {
    const memberNodeIds = group.nodeIds.filter(
      (nodeId) => absolutePositions[nodeId] !== undefined,
    );
    if (memberNodeIds.length === 0) return [];
    for (const nodeId of memberNodeIds) groupByNode.set(nodeId, group);
    const memberPositions = memberNodeIds.map(
      (nodeId) => absolutePositions[nodeId] as CanvasPosition,
    );
    const minX = Math.min(...memberPositions.map(({ x }) => x));
    const minY = Math.min(...memberPositions.map(({ y }) => y));
    const maxX = Math.max(...memberPositions.map(({ x }) => x));
    const maxY = Math.max(...memberPositions.map(({ y }) => y));
    const origin = { x: minX - GROUP_PADDING_X, y: minY - GROUP_PADDING_TOP };
    return [
      {
        data: {
          color: group.color,
          memberNodeIds,
          origin,
          title: group.title,
        },
        id: `view-group:${group.id}`,
        position: origin,
        selectable: false,
        style: {
          background: `${group.color}12`,
          border: `1px solid ${group.color}80`,
          borderRadius: 12,
          color: group.color,
          fontSize: 11,
          fontWeight: 700,
          height:
            maxY -
            minY +
            NODE_HEIGHT_ESTIMATE +
            GROUP_PADDING_TOP +
            GROUP_PADDING_BOTTOM,
          letterSpacing: '0.06em',
          padding: '12px 16px',
          textTransform: 'uppercase',
          width: maxX - minX + NODE_WIDTH + GROUP_PADDING_X * 2,
        },
        type: 'canvasGroup',
      },
    ];
  });
  const conversationNodes = orderedNodeIds(graph).map((id) => {
    const node = graph.nodes[id] as GraphNode;
    const text = revisionText(graph, id);
    const group = groupByNode.get(id);
    const absolutePosition = absolutePositions[id] as CanvasPosition;
    const parentId = group === undefined ? undefined : `view-group:${group.id}`;
    const groupNode =
      parentId === undefined
        ? undefined
        : groupNodes.find((candidate) => candidate.id === parentId);
    const position =
      groupNode === undefined
        ? absolutePosition
        : {
            x: absolutePosition.x - groupNode.position.x,
            y: absolutePosition.y - groupNode.position.y,
          };
    return {
      data: {
        attachmentCompatibility: options.attachmentCompatibility?.[id] ?? null,
        contextMode: options.contextSelections?.[id]?.mode ?? 'full',
        flowMode: options.activeFlow?.mode ?? null,
        flowState: hasActiveFlow
          ? activeNodeIds.has(id)
            ? 'active'
            : 'inactive'
          : 'idle',
        kind: node.kind,
        preview: text.length > 180 ? `${text.slice(0, 177)}…` : text,
        role: node.role,
        title: nodeTitle(graph, id),
      },
      id,
      ...(parentId === undefined
        ? {}
        : { expandParent: true, extent: 'parent' as const, parentId }),
      position,
      selected: selectedNodeIds.has(id),
      type: 'conversation',
    } satisfies ConversationFlowNode;
  });
  return [...groupNodes, ...conversationNodes];
}

export function toFlowEdges(
  graph: GraphSnapshot,
  activeFlow: ActiveContextFlow | null = null,
  incompatibleAttachmentNodeIds: readonly string[] = [],
): Edge[] {
  const activeEdgeIds = new Set(activeFlow?.edgeIds ?? []);
  const incompatibleNodes = new Set(incompatibleAttachmentNodeIds);
  return Object.values(graph.edges)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((edge) => {
      const presentation = edgePresentation[edge.kind];
      const flowState: ContextFlowState =
        activeFlow === null
          ? 'idle'
          : activeEdgeIds.has(edge.id)
            ? 'active'
            : 'inactive';
      const incompatibleAttachment =
        edge.kind === 'context' &&
        (incompatibleNodes.has(edge.sourceNodeId) ||
          incompatibleNodes.has(edge.targetNodeId));
      return {
        animated: flowState === 'active',
        className: `context-flow-edge context-flow-edge--${flowState}${flowState === 'active' && activeFlow !== null ? ` context-flow-edge--${activeFlow.mode}` : ''}${incompatibleAttachment ? ' context-flow-edge--incompatible' : ''}`,
        data: {
          incompatibleAttachment,
          flowMode: activeFlow?.mode ?? null,
          flowState,
          kind: edge.kind,
        },
        id: edge.id,
        label: edgeLabel(edge),
        markerEnd: {
          color: presentation.color,
          height: 16,
          type: MarkerType.ArrowClosed,
          width: 16,
        },
        source: edge.sourceNodeId,
        style: {
          stroke: presentation.color,
          strokeDasharray: presentation.dash,
          strokeWidth: edge.kind === 'context' ? 2.4 : 1.8,
          opacity: flowState === 'inactive' ? 0.16 : 1,
        },
        target: edge.targetNodeId,
        type: 'smoothstep',
      } satisfies Edge;
    });
}

export function contextThread(
  graph: GraphSnapshot,
  headNodeId: string,
): readonly string[] {
  if (graph.nodes[headNodeId] === undefined) return [];

  const incoming = new Map<string, ContextEdge[]>();
  for (const edge of Object.values(graph.edges)) {
    if (edge.kind !== 'context') continue;
    const current = incoming.get(edge.targetNodeId) ?? [];
    current.push(edge);
    incoming.set(edge.targetNodeId, current);
  }
  for (const edges of incoming.values()) {
    edges.sort((left, right) => left.slot - right.slot);
  }

  const visited = new Set<string>();
  const result: string[] = [];
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const edge of incoming.get(nodeId) ?? []) {
      visit(edge.sourceNodeId);
    }
    result.push(nodeId);
  };
  visit(headNodeId);
  return result;
}
