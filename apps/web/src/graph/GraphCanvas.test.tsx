import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type * as ReactFlowModule from '@xyflow/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  templateBindingHandleId,
  type WaterLilyFlowNode,
} from './graphViewModel';

interface FlowPropsCapture {
  readonly edges: ReactFlowModule.Edge[];
  readonly nodes: WaterLilyFlowNode[];
  readonly onConnect: (connection: ReactFlowModule.Connection) => void;
  readonly onInit: (
    instance: ReactFlowModule.ReactFlowInstance<WaterLilyFlowNode>,
  ) => void;
  readonly onNodeClick: (
    event: { readonly shiftKey?: boolean },
    node: WaterLilyFlowNode,
  ) => void;
  readonly onNodeDragStop: (event: unknown, node: WaterLilyFlowNode) => void;
  readonly onNodesChange: ReactFlowModule.OnNodesChange<WaterLilyFlowNode>;
  readonly onPaneClick: () => void;
}

interface MiniMapPropsCapture {
  readonly nodeColor: (node: WaterLilyFlowNode) => string;
}

const capture = vi.hoisted(() => ({
  flow: undefined as FlowPropsCapture | undefined,
  miniMap: undefined as MiniMapPropsCapture | undefined,
  screenToFlowPosition: vi.fn(() => ({ x: 50, y: 75 })),
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
      props.onInit({
        screenToFlowPosition: capture.screenToFlowPosition,
      } as unknown as ReactFlowModule.ReactFlowInstance<WaterLilyFlowNode>);
      return props.children;
    },
  };
});

import { sampleGraph } from '../sampleGraph';
import { useWaterLilyStore } from '../state/waterlilyStore';
import { GraphCanvas } from './GraphCanvas';

const uploadAttachment = vi.fn((file: File) =>
  Promise.resolve({
    id: `attachment-${file.name}`,
    mediaType: file.type || 'application/octet-stream',
    name: file.name,
    sha256: 'a'.repeat(64),
    size: file.size,
  }),
);

function renderCanvas(props: Partial<ComponentProps<typeof GraphCanvas>> = {}) {
  return render(
    <GraphCanvas
      graph={sampleGraph}
      model={null}
      uploadAttachment={uploadAttachment}
      {...props}
    />,
  );
}

describe('GraphCanvas', () => {
  beforeEach(() => {
    useWaterLilyStore.getState().reset();
    capture.flow = undefined;
    capture.miniMap = undefined;
    capture.screenToFlowPosition.mockClear();
    uploadAttachment.mockClear();
  });

  it('wires selection, dragging, deselection, and minimap semantics', () => {
    renderCanvas();
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
    expect(useWaterLilyStore.getState().selectedNodeId).toBe('node-answer');

    act(() => {
      flow.onNodeDragStop({}, { ...answer, position: { x: 88, y: 144 } });
    });
    expect(useWaterLilyStore.getState().positions['node-answer']).toEqual({
      x: 88,
      y: 144,
    });

    act(() => {
      flow.onPaneClick();
    });
    expect(useWaterLilyStore.getState().selectedNodeId).toBeNull();

    expect(miniMap.nodeColor(user)).toBe('#58779a');
    expect(miniMap.nodeColor(answer)).toBe('#547a68');
    expect(miniMap.nodeColor(system)).toBe('#7f7162');
    expect(miniMap.nodeColor(summary)).toBe('#b06b3e');
    expect(miniMap.nodeColor(note)).toBe('#7669a8');
  });

  it('supports additive selection and translates grouped drag positions', () => {
    useWaterLilyStore.getState().addGroup({
      collapsed: false,
      color: '#7669a8',
      id: 'group-review',
      nodeIds: ['node-answer', 'node-side-answer'],
      title: 'Review path',
    });
    renderCanvas();
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
    expect(useWaterLilyStore.getState().selectedNodeIds).toEqual([
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
    expect(useWaterLilyStore.getState().positions['node-answer']).toEqual({
      x: 680,
      y: 15,
    });
    expect(useWaterLilyStore.getState().positions['node-side-answer']).toEqual({
      x: 1340,
      y: 15,
    });
    expect(miniMap.nodeColor(group)).toBe('#7669a844');
  });

  it('connects a node output to a template input pin', () => {
    useWaterLilyStore.getState().reviseText({
      blockId: 'block-node-note',
      createdAt: '2026-08-17T10:00:00.000Z',
      nodeId: 'node-note',
      revisionId: 'revision-note-template',
      text: 'Apply {{mechanism}}',
    });
    renderCanvas({ graph: useWaterLilyStore.getState().graph });
    const flow = capture.flow;
    expect(flow).toBeDefined();
    if (flow === undefined) return;
    const revisionBefore =
      useWaterLilyStore.getState().graph.nodes['node-note']?.currentRevisionId;
    act(() => {
      flow.onConnect({
        source: 'node-answer',
        sourceHandle: 'text-output',
        target: 'node-note',
        targetHandle: 'context-target',
      });
    });
    expect(
      useWaterLilyStore.getState().graph.nodes['node-note']?.currentRevisionId,
    ).toBe(revisionBefore);
    act(() => {
      flow.onConnect({
        source: 'node-answer',
        sourceHandle: 'text-output',
        target: 'node-note',
        targetHandle: templateBindingHandleId('block-node-note', 'mechanism'),
      });
    });
    const note = useWaterLilyStore.getState().graph.nodes['node-note'];
    const revision =
      note === undefined
        ? undefined
        : useWaterLilyStore.getState().graph.revisions[note.currentRevisionId];
    expect(revision?.blocks[0]).toMatchObject({
      template: {
        bindings: [
          {
            name: 'mechanism',
            sourceNodeId: 'node-answer',
            sourceRevisionId: 'revision-node-answer',
          },
        ],
      },
    });
    expect(
      screen.getByText('Connected {{mechanism}} to Mechanism overview.'),
    ).toBeVisible();
  });

  it('projects active generation nodes and edges into React Flow', () => {
    renderCanvas({
      activeFlow: {
        edgeIds: ['edge-answer-synthesis'],
        mode: 'running',
        nodeIds: ['node-answer', 'node-synthesis'],
      },
    });
    const flow = capture.flow;
    expect(flow).toBeDefined();
    if (flow === undefined) return;

    expect(
      flow.nodes.find((node) => node.id === 'node-answer')?.data,
    ).toMatchObject({ flowState: 'active' });
    expect(
      flow.nodes.find((node) => node.id === 'node-note')?.data,
    ).toMatchObject({ flowState: 'inactive' });
    expect(
      flow.edges.find((edge) => edge.id === 'edge-answer-synthesis'),
    ).toMatchObject({ animated: true, data: { flowState: 'active' } });
    expect(
      flow.edges.find((edge) => edge.id === 'edge-answer-note'),
    ).toMatchObject({ animated: false, data: { flowState: 'inactive' } });
  });

  it('retains measured dimensions across controlled graph projections', async () => {
    renderCanvas();
    const flow = capture.flow;
    expect(flow).toBeDefined();
    if (flow === undefined) return;

    act(() => {
      flow.onNodesChange([
        {
          dimensions: { height: 172, width: 246 },
          id: 'node-answer',
          type: 'dimensions',
        },
      ]);
    });

    await waitFor(() => {
      expect(
        capture.flow?.nodes.find((node) => node.id === 'node-answer')?.measured,
      ).toEqual({ height: 172, width: 246 });
    });

    act(() => {
      capture.flow?.onNodesChange([
        {
          dimensions: { height: 172, width: 246 },
          id: 'node-answer',
          type: 'dimensions',
        },
        {
          dimensions: { height: 172, width: 248 },
          id: 'node-answer',
          type: 'dimensions',
        },
      ]);
    });
    await waitFor(() => {
      expect(
        capture.flow?.nodes.find((node) => node.id === 'node-answer')?.measured,
      ).toEqual({ height: 172, width: 248 });
    });

    act(() => {
      useWaterLilyStore.getState().selectNode('node-answer');
    });
    await waitFor(() => {
      expect(
        capture.flow?.nodes.find((node) => node.id === 'node-answer'),
      ).toMatchObject({
        measured: { height: 172, width: 248 },
        selected: true,
      });
    });

    act(() => {
      capture.flow?.onNodesChange([
        { id: 'node-answer', type: 'remove' },
        { id: 'missing-node', type: 'remove' },
        {
          dragging: true,
          id: 'node-answer',
          position: { x: 80, y: 90 },
          type: 'position',
        },
      ]);
    });
    await waitFor(() => {
      expect(
        capture.flow?.nodes.find((node) => node.id === 'node-answer')?.measured,
      ).toBeUndefined();
    });
  });

  it('drops text files at canvas coordinates and connects them to selection', async () => {
    renderCanvas();
    const canvas = screen.getByRole('region', {
      name: 'Conversation graph canvas',
    });
    const file = new File(['Study evidence'], 'evidence.txt', {
      lastModified: 42,
      type: 'text/plain',
    });
    const dataTransfer = {
      dropEffect: 'none',
      files: [file],
      types: ['Files'],
    };

    fireEvent.dragEnter(canvas, { dataTransfer });
    expect(
      screen.getByText('Connect files to this context'),
    ).toBeInTheDocument();
    fireEvent.dragOver(canvas, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('copy');
    const dropEvent = createEvent.drop(canvas, { dataTransfer });
    Object.defineProperties(dropEvent, {
      clientX: { value: 300 },
      clientY: { value: 200 },
    });
    fireEvent(canvas, dropEvent);

    await waitFor(() => {
      expect(
        screen.getByText('Connected 1 file to Merged understanding.'),
      ).toBeInTheDocument();
    });
    const state = useWaterLilyStore.getState();
    const fileNode = Object.values(state.graph.nodes).find(
      (node) => node.title === 'evidence.txt',
    );
    expect(fileNode).toBeDefined();
    expect(state.positions[fileNode?.id ?? '']).toEqual({ x: 50, y: 75 });
    expect(
      Object.values(state.graph.edges).find(
        (edge) => edge.kind === 'context' && edge.sourceNodeId === fileNode?.id,
      ),
    ).toMatchObject({
      label: 'file context',
      targetNodeId: 'node-synthesis',
    });
    expect(capture.screenToFlowPosition).toHaveBeenCalledWith({
      x: 300,
      y: 200,
    });
    expect(uploadAttachment).toHaveBeenCalledWith(file);
  });

  it('shows safe validation feedback and leaves the graph unchanged', async () => {
    const nodeCount = Object.keys(
      useWaterLilyStore.getState().graph.nodes,
    ).length;
    renderCanvas();
    const canvas = screen.getByRole('region', {
      name: 'Conversation graph canvas',
    });
    const dataTransfer = {
      dropEffect: 'none',
      files: [
        new File(['program'], 'program.exe', {
          type: 'application/x-msdownload',
        }),
      ],
      types: ['Files'],
    };

    fireEvent.dragEnter(canvas, { dataTransfer });
    fireEvent.dragLeave(canvas, { dataTransfer });
    expect(
      screen.queryByText('Connect files to this context'),
    ).not.toBeInTheDocument();
    fireEvent.drop(canvas, { dataTransfer });

    await waitFor(() => {
      expect(
        screen.getByText(
          'program.exe is not a supported native attachment type.',
        ),
      ).toBeInTheDocument();
    });
    expect(Object.keys(useWaterLilyStore.getState().graph.nodes)).toHaveLength(
      nodeCount,
    );
  });

  it('creates multiple standalone file nodes and ignores non-file drags', async () => {
    useWaterLilyStore.getState().selectNode(null);
    renderCanvas();
    const canvas = screen.getByRole('region', {
      name: 'Conversation graph canvas',
    });
    const textTransfer = {
      dropEffect: 'none',
      files: [],
      types: ['text/plain'],
    };
    fireEvent.dragEnter(canvas, { dataTransfer: textTransfer });
    fireEvent.dragOver(canvas, { dataTransfer: textTransfer });
    fireEvent.dragLeave(canvas, { dataTransfer: textTransfer });
    fireEvent.drop(canvas, { dataTransfer: textTransfer });
    expect(
      screen.queryByText('Connect files to this context'),
    ).not.toBeInTheDocument();

    const dataTransfer = {
      dropEffect: 'none',
      files: [
        new File(['one'], 'one.txt', { type: 'text/plain' }),
        new File(['two'], 'two.txt', { type: 'text/plain' }),
      ],
      types: ['Files'],
    };
    fireEvent.dragEnter(canvas, { dataTransfer });
    fireEvent.dragEnter(canvas, { dataTransfer });
    expect(
      screen.getByText('Release to create standalone context nodes'),
    ).toBeInTheDocument();
    fireEvent.dragLeave(canvas, { dataTransfer });
    expect(
      screen.getByText('Connect files to this context'),
    ).toBeInTheDocument();
    fireEvent.drop(canvas, { dataTransfer });

    await waitFor(() => {
      expect(
        screen.getByText('Created 2 file context nodes.'),
      ).toBeInTheDocument();
    });
    const state = useWaterLilyStore.getState();
    const created = Object.values(state.graph.nodes).filter(
      (node) => node.title === 'one.txt' || node.title === 'two.txt',
    );
    expect(created).toHaveLength(2);
    expect(state.selectedNodeId).toBe(
      created.find((node) => node.title === 'two.txt')?.id,
    );
    expect(state.positions[created[0]?.id ?? '']).toEqual({ x: 50, y: 75 });
    expect(state.positions[created[1]?.id ?? '']).toEqual({ x: 50, y: 255 });
  });
});
