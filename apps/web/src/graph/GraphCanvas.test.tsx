import { act, render } from '@testing-library/react';
import type * as ReactFlowModule from '@xyflow/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkbenchFlowNode } from './graphViewModel';

interface FlowPropsCapture {
  readonly nodes: WorkbenchFlowNode[];
  readonly onNodeClick: (
    event: { readonly shiftKey?: boolean },
    node: WorkbenchFlowNode,
  ) => void;
  readonly onNodeDragStop: (event: unknown, node: WorkbenchFlowNode) => void;
  readonly onPaneClick: () => void;
}

interface MiniMapPropsCapture {
  readonly nodeColor: (node: WorkbenchFlowNode) => string;
}

const capture = vi.hoisted(() => ({
  flow: undefined as FlowPropsCapture | undefined,
  miniMap: undefined as MiniMapPropsCapture | undefined,
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactFlowModule>();
  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    MiniMap: (props: MiniMapPropsCapture) => {
      capture.miniMap = props;
      return null;
    },
    ReactFlow: (
      props: FlowPropsCapture & { readonly children?: ReactNode },
    ): ReactNode => {
      capture.flow = props;
      return props.children;
    },
  };
});

import { sampleGraph } from '../sampleGraph';
import { useWorkbenchStore } from '../state/workbenchStore';
import { GraphCanvas } from './GraphCanvas';

describe('GraphCanvas', () => {
  beforeEach(() => {
    useWorkbenchStore.getState().reset();
    capture.flow = undefined;
    capture.miniMap = undefined;
  });

  it('wires selection, dragging, deselection, and minimap semantics', () => {
    render(<GraphCanvas graph={sampleGraph} />);
    const flow = capture.flow;
    const miniMap = capture.miniMap;
    expect(flow).toBeDefined();
    expect(miniMap).toBeDefined();
    if (flow === undefined || miniMap === undefined) return;

    const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
    const answer = nodesById.get('node-answer');
    const user = nodesById.get('node-question');
    const system = nodesById.get('node-system');
    const summary = nodesById.get('node-synthesis');
    const note = nodesById.get('node-note');
    expect(answer).toBeDefined();
    expect(user).toBeDefined();
    expect(system).toBeDefined();
    expect(summary).toBeDefined();
    expect(note).toBeDefined();
    if (
      answer === undefined ||
      user === undefined ||
      system === undefined ||
      summary === undefined ||
      note === undefined
    ) {
      return;
    }

    act(() => {
      flow.onNodeClick({ shiftKey: false }, answer);
    });
    expect(useWorkbenchStore.getState().selectedNodeId).toBe('node-answer');

    act(() => {
      flow.onNodeDragStop({}, { ...answer, position: { x: 88, y: 144 } });
    });
    expect(useWorkbenchStore.getState().positions['node-answer']).toEqual({
      x: 88,
      y: 144,
    });

    act(() => {
      flow.onPaneClick();
    });
    expect(useWorkbenchStore.getState().selectedNodeId).toBeNull();

    expect(miniMap.nodeColor(user)).toBe('#58779a');
    expect(miniMap.nodeColor(answer)).toBe('#547a68');
    expect(miniMap.nodeColor(system)).toBe('#7f7162');
    expect(miniMap.nodeColor(summary)).toBe('#b06b3e');
    expect(miniMap.nodeColor(note)).toBe('#7669a8');
  });

  it('supports additive selection and translates grouped drag positions', () => {
    useWorkbenchStore.getState().addGroup({
      collapsed: false,
      color: '#7669a8',
      id: 'group-review',
      nodeIds: ['node-answer', 'node-side-answer'],
      title: 'Review path',
    });
    render(<GraphCanvas graph={sampleGraph} />);
    const flow = capture.flow;
    const miniMap = capture.miniMap;
    expect(flow).toBeDefined();
    expect(miniMap).toBeDefined();
    if (flow === undefined || miniMap === undefined) return;

    const group = flow.nodes.find(
      (node) => node.id === 'view-group:group-review',
    );
    const answer = flow.nodes.find((node) => node.id === 'node-answer');
    const sideAnswer = flow.nodes.find(
      (node) => node.id === 'node-side-answer',
    );
    expect(group).toBeDefined();
    expect(answer).toBeDefined();
    expect(sideAnswer).toBeDefined();
    if (group === undefined || answer === undefined || sideAnswer === undefined)
      return;

    act(() => {
      flow.onNodeClick({ shiftKey: false }, answer);
      flow.onNodeClick({ shiftKey: true }, sideAnswer);
    });
    expect(useWorkbenchStore.getState().selectedNodeIds).toEqual([
      'node-answer',
      'node-side-answer',
    ]);

    act(() => {
      flow.onNodeDragStop(
        {},
        {
          ...group,
          position: { x: group.position.x + 20, y: group.position.y + 15 },
        },
      );
    });
    expect(useWorkbenchStore.getState().positions['node-answer']).toEqual({
      x: 680,
      y: 15,
    });
    expect(useWorkbenchStore.getState().positions['node-side-answer']).toEqual({
      x: 1340,
      y: 15,
    });
    expect(miniMap.nodeColor(group)).toBe('#7669a844');
  });
});
