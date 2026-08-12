import type { WorkspaceSnapshot } from '@waterlily/api-contract';
import type { ContextSelection } from '@waterlily/context-engine';
import {
  connectContext,
  createNode,
  type GraphSnapshot,
} from '@waterlily/domain';
import {
  mergeGraphDocument,
  type GraphDocumentV1,
  type GraphViewGroup,
  type IdRemapper,
} from '@waterlily/interchange';
import {
  branchFromNode,
  mergeBranches,
  splitNode,
  type BranchInput,
  type MergeInput,
  type SplitInput,
} from '@waterlily/workflows';
import { create } from 'zustand';

import type { PreparedDroppedFile } from '../files/fileDrop';
import type { CanvasPosition, CanvasPositions } from '../graph/graphViewModel';
import { sampleGraph } from '../sampleGraph';

export type ViewMode = 'canvas' | 'focus';

export interface FileContextNodeInput {
  readonly blockId: string;
  readonly edgeId: string | null;
  readonly file: PreparedDroppedFile;
  readonly nodeId: string;
  readonly position: CanvasPosition;
  readonly revisionId: string;
}

export interface AddFileContextsInput {
  readonly createdAt: string;
  readonly files: readonly FileContextNodeInput[];
  readonly targetNodeId: string | null;
}

interface WaterLilyState {
  readonly contextSelections: Readonly<Record<string, ContextSelection>>;
  readonly graph: GraphSnapshot;
  readonly groups: readonly GraphViewGroup[];
  readonly positions: CanvasPositions;
  readonly selectedNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
  readonly viewMode: ViewMode;
  readonly addFileContexts: (input: AddFileContextsInput) => void;
  readonly addGroup: (group: GraphViewGroup) => void;
  readonly branch: (input: Omit<BranchInput, 'graph'>) => void;
  readonly merge: (input: Omit<MergeInput, 'graph'>) => void;
  readonly mergeDocument: (
    document: GraphDocumentV1,
    remapId: IdRemapper,
  ) => void;
  readonly replaceWorkspace: (workspace: WorkspaceSnapshot) => void;
  readonly reset: () => void;
  readonly selectNode: (nodeId: string | null, additive?: boolean) => void;
  readonly setPosition: (nodeId: string, position: CanvasPosition) => void;
  readonly setPositions: (positions: CanvasPositions) => void;
  readonly setContextSelection: (
    nodeId: string,
    selection: ContextSelection,
  ) => void;
  readonly setViewMode: (mode: ViewMode) => void;
  readonly split: (input: Omit<SplitInput, 'graph'>) => void;
  readonly toggleContext: (nodeId: string) => void;
}

function initialState() {
  return {
    contextSelections: {},
    graph: structuredClone(sampleGraph),
    groups: [],
    positions: {},
    selectedNodeId: 'node-synthesis',
    selectedNodeIds: ['node-synthesis'],
    viewMode: 'canvas' as const,
  };
}

export const useWaterLilyStore = create<WaterLilyState>()((set) => ({
  ...initialState(),
  addFileContexts: (input) => {
    set((state) => {
      if (input.files.length === 0)
        throw new TypeError('At least one dropped file is required');
      if (
        input.targetNodeId !== null &&
        state.graph.nodes[input.targetNodeId] === undefined
      ) {
        throw new TypeError('The file context target does not exist');
      }

      let graph = state.graph;
      let nextSlot =
        input.targetNodeId === null
          ? 0
          : Math.max(
              -1,
              ...Object.values(graph.edges).flatMap((edge) =>
                edge.kind === 'context' &&
                edge.targetNodeId === input.targetNodeId
                  ? [edge.slot]
                  : [],
              ),
            ) + 1;
      const positions: Record<string, CanvasPosition> = {};

      for (const item of input.files) {
        if (input.targetNodeId !== null && item.edgeId === null) {
          throw new TypeError('Connected file context requires an edge ID');
        }
        graph = createNode(graph, {
          blocks: [
            {
              format: 'plain',
              id: item.blockId,
              text: item.file.text,
              type: 'text',
            },
          ],
          createdAt: input.createdAt,
          kind: 'attachment',
          metadata: {
            file: {
              lastModified: item.file.lastModified,
              mediaType: item.file.mediaType,
              name: item.file.name,
              size: item.file.size,
              source: 'drop',
            },
          },
          nodeId: item.nodeId,
          revisionId: item.revisionId,
          title: item.file.name,
        });
        if (input.targetNodeId !== null && item.edgeId !== null) {
          graph = connectContext(graph, {
            createdAt: input.createdAt,
            edgeId: item.edgeId,
            label: 'file context',
            slot: nextSlot,
            sourceNodeId: item.nodeId,
            targetNodeId: input.targetNodeId,
          });
          nextSlot += 1;
        }
        positions[item.nodeId] = item.position;
      }

      const selectedNodeId =
        input.targetNodeId ?? input.files.at(-1)?.nodeId ?? null;
      return {
        graph,
        positions: { ...state.positions, ...positions },
        selectedNodeId,
        selectedNodeIds: selectedNodeId === null ? [] : [selectedNodeId],
      };
    });
  },
  addGroup: (group) => {
    set((state) => {
      if (
        group.title.trim().length === 0 ||
        !/^#[0-9a-fA-F]{6}$/u.test(group.color) ||
        group.nodeIds.length === 0 ||
        state.groups.some((current) => current.id === group.id) ||
        new Set(group.nodeIds).size !== group.nodeIds.length ||
        group.nodeIds.some(
          (nodeId) =>
            state.graph.nodes[nodeId] === undefined ||
            state.groups.some((current) => current.nodeIds.includes(nodeId)),
        )
      ) {
        throw new TypeError('The canvas group is invalid');
      }
      return { groups: [...state.groups, structuredClone(group)] };
    });
  },
  branch: (input) => {
    set((state) => ({
      graph: branchFromNode({ ...input, graph: state.graph }),
      selectedNodeId: input.message.nodeId,
      selectedNodeIds: [input.message.nodeId],
    }));
  },
  merge: (input) => {
    set((state) => ({
      graph: mergeBranches({ ...input, graph: state.graph }),
      selectedNodeId: input.message.nodeId,
      selectedNodeIds: [input.message.nodeId],
    }));
  },
  mergeDocument: (document, remapId) => {
    set((state) => {
      const imported = mergeGraphDocument({
        document,
        remapId,
        targetGraph: state.graph,
        targetView: { groups: state.groups, positions: state.positions },
      });
      const importedNodeIds = Object.values(imported.mapping.nodes);
      const selectedNodeId = importedNodeIds.at(-1) ?? state.selectedNodeId;
      return {
        graph: imported.graph,
        groups: imported.view.groups,
        positions: imported.view.positions,
        selectedNodeId,
        selectedNodeIds: selectedNodeId === null ? [] : [selectedNodeId],
      };
    });
  },
  reset: () => {
    set(initialState());
  },
  replaceWorkspace: (workspace) => {
    set((state) => {
      const selectedNodeId =
        state.selectedNodeId !== null &&
        workspace.graph.nodes[state.selectedNodeId] !== undefined
          ? state.selectedNodeId
          : (Object.keys(workspace.graph.nodes).at(-1) ?? null);
      return {
        contextSelections: structuredClone(workspace.state.contextSelections),
        graph: structuredClone(workspace.graph),
        groups: structuredClone(workspace.state.view.groups),
        positions: structuredClone(workspace.state.view.positions),
        selectedNodeId,
        selectedNodeIds: selectedNodeId === null ? [] : [selectedNodeId],
      };
    });
  },
  selectNode: (nodeId, additive = false) => {
    set((state) => {
      if (nodeId === null) return { selectedNodeId: null, selectedNodeIds: [] };
      if (!additive)
        return { selectedNodeId: nodeId, selectedNodeIds: [nodeId] };
      const alreadySelected = state.selectedNodeIds.includes(nodeId);
      const selectedNodeIds = alreadySelected
        ? state.selectedNodeIds.filter((id) => id !== nodeId)
        : [...state.selectedNodeIds, nodeId];
      return {
        selectedNodeId: alreadySelected
          ? (selectedNodeIds.at(-1) ?? null)
          : nodeId,
        selectedNodeIds,
      };
    });
  },
  setPosition: (nodeId, position) => {
    set((state) => ({
      positions: { ...state.positions, [nodeId]: position },
    }));
  },
  setPositions: (positions) => {
    set((state) => ({ positions: { ...state.positions, ...positions } }));
  },
  setContextSelection: (nodeId, selection) => {
    set((state) => ({
      contextSelections: {
        ...state.contextSelections,
        [nodeId]: structuredClone(selection),
      },
    }));
  },
  setViewMode: (viewMode) => {
    set({ viewMode });
  },
  split: (input) => {
    set((state) => {
      const result = splitNode({ ...input, graph: state.graph });
      return {
        graph: result.graph,
        selectedNodeId: result.nodeIds.at(-1) ?? null,
        selectedNodeIds: result.nodeIds,
      };
    });
  },
  toggleContext: (nodeId) => {
    set((state) => {
      const current = state.contextSelections[nodeId]?.mode ?? 'full';
      return {
        contextSelections: {
          ...state.contextSelections,
          [nodeId]: { mode: current === 'excluded' ? 'full' : 'excluded' },
        },
      };
    });
  },
}));
