import type { WorkspaceSnapshot } from '@llm-graph/api-contract';
import type { ContextSelection } from '@llm-graph/context-engine';
import type { GraphSnapshot } from '@llm-graph/domain';
import {
  mergeGraphDocument,
  type GraphDocumentV1,
  type GraphViewGroup,
  type IdRemapper,
} from '@llm-graph/interchange';
import {
  branchFromNode,
  mergeBranches,
  splitNode,
  type BranchInput,
  type MergeInput,
  type SplitInput,
} from '@llm-graph/workflows';
import { create } from 'zustand';

import type { CanvasPosition, CanvasPositions } from '../graph/graphViewModel';
import { sampleGraph } from '../sampleGraph';

export type ViewMode = 'canvas' | 'focus';

interface WorkbenchState {
  readonly contextSelections: Readonly<Record<string, ContextSelection>>;
  readonly graph: GraphSnapshot;
  readonly groups: readonly GraphViewGroup[];
  readonly positions: CanvasPositions;
  readonly selectedNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
  readonly viewMode: ViewMode;
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

export const useWorkbenchStore = create<WorkbenchState>()((set) => ({
  ...initialState(),
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
