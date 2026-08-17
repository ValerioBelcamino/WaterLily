import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import type { GraphSnapshot } from '@waterlily/domain';
import type {
  AttachmentDescriptor,
  ModelDescriptor,
} from '@waterlily/api-contract';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { prepareDroppedFiles } from '../files/fileDrop';
import { attachmentCompatibilityByNode } from '../files/compatibility';
import { createPortableId } from '../ids';
import { useWaterLilyStore } from '../state/waterlilyStore';
import { CanvasGroupNode } from './CanvasGroupNode';
import { ConversationNode } from './ConversationNode';
import {
  toFlowEdges,
  toFlowNodes,
  deriveActiveContextFlow,
  type ActiveContextFlow,
  type WaterLilyFlowNode,
} from './graphViewModel';

const nodeTypes = {
  canvasGroup: CanvasGroupNode,
  conversation: ConversationNode,
} as const;

function miniMapColor(node: WaterLilyFlowNode): string {
  if (node.type === 'canvasGroup') return `${node.data.color}44`;
  if (node.data.role === 'user') return '#58779a';
  if (node.data.role === 'assistant') return '#547a68';
  if (node.data.role === 'system') return '#7f7162';
  return node.data.kind === 'summary' ? '#b06b3e' : '#7669a8';
}

export interface GraphCanvasProps {
  readonly activeFlow?: ActiveContextFlow | null;
  readonly graph: GraphSnapshot;
  readonly model: ModelDescriptor | null;
  readonly uploadAttachment: (file: File) => Promise<AttachmentDescriptor>;
}

export function GraphCanvas({
  activeFlow = null,
  graph,
  model,
  uploadAttachment,
}: GraphCanvasProps) {
  const [dragActive, setDragActive] = useState(false);
  const [dropStatus, setDropStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    readonly flow: ActiveContextFlow;
    readonly key: string;
  } | null>(null);
  const dragDepth = useRef(0);
  const flowInstance = useRef<ReactFlowInstance<WaterLilyFlowNode> | null>(
    null,
  );
  const addFileContexts = useWaterLilyStore((state) => state.addFileContexts);
  const positions = useWaterLilyStore((state) => state.positions);
  const contextSelections = useWaterLilyStore(
    (state) => state.contextSelections,
  );
  const groups = useWaterLilyStore((state) => state.groups);
  const selectedNodeId = useWaterLilyStore((state) => state.selectedNodeId);
  const selectedNodeIds = useWaterLilyStore((state) => state.selectedNodeIds);
  const selectNode = useWaterLilyStore((state) => state.selectNode);
  const setPosition = useWaterLilyStore((state) => state.setPosition);
  const setPositions = useWaterLilyStore((state) => state.setPositions);
  const previewKey =
    selectedNodeIds.length === 0
      ? null
      : JSON.stringify([graph.updatedAt, selectedNodeIds, contextSelections]);
  useEffect(() => {
    if (previewKey === null) return;
    let current = true;
    const heads = selectedNodeIds.map((nodeId, slot) => ({
      label: graph.nodes[nodeId]?.title ?? `Context ${String(slot + 1)}`,
      nodeId,
      slot,
    }));
    void deriveActiveContextFlow(
      graph,
      heads,
      contextSelections,
      'preview',
    ).then(
      (flow) => {
        if (current) setPreview({ flow, key: previewKey });
      },
      () => {
        if (current) setPreview(null);
      },
    );
    return () => {
      current = false;
    };
  }, [contextSelections, graph, previewKey, selectedNodeIds]);
  const visibleFlow =
    activeFlow ?? (preview?.key === previewKey ? preview.flow : null);
  const attachmentCompatibility = useMemo(
    () => attachmentCompatibilityByNode(graph, model),
    [graph, model],
  );
  const incompatibleAttachmentNodeIds = useMemo(
    () =>
      Object.entries(attachmentCompatibility)
        .filter(([, compatibility]) => compatibility === 'unsupported')
        .map(([nodeId]) => nodeId),
    [attachmentCompatibility],
  );
  const nodes = useMemo(
    () =>
      toFlowNodes(graph, {
        activeFlow: visibleFlow,
        attachmentCompatibility,
        contextSelections,
        groups,
        positions,
        selectedNodeIds,
      }),
    [
      contextSelections,
      attachmentCompatibility,
      graph,
      groups,
      positions,
      selectedNodeIds,
      visibleFlow,
    ],
  );
  const edges = useMemo(
    () => toFlowEdges(graph, visibleFlow, incompatibleAttachmentNodeIds),
    [graph, incompatibleAttachmentNodeIds, visibleFlow],
  );

  const handleNodeClick: NodeMouseHandler<WaterLilyFlowNode> = (
    event,
    node,
  ) => {
    if (node.type === 'conversation') selectNode(node.id, event.shiftKey);
  };

  const handleNodeDragStop: OnNodeDrag<WaterLilyFlowNode> = (_event, node) => {
    if (node.type === 'canvasGroup') {
      const delta = {
        x: node.position.x - node.data.origin.x,
        y: node.position.y - node.data.origin.y,
      };
      setPositions(
        Object.fromEntries(
          node.data.memberNodeIds.map((nodeId) => {
            const current = positions[nodeId];
            const projected = nodes.find(
              (candidate) => candidate.id === nodeId,
            );
            const parent = nodes.find(
              (candidate) => candidate.id === projected?.parentId,
            );
            const fallback =
              projected === undefined
                ? { x: 0, y: 0 }
                : {
                    x: projected.position.x + (parent?.position.x ?? 0),
                    y: projected.position.y + (parent?.position.y ?? 0),
                  };
            const position = current ?? fallback;
            return [
              nodeId,
              { x: position.x + delta.x, y: position.y + delta.y },
            ];
          }),
        ),
      );
      return;
    }
    const parent = nodes.find((candidate) => candidate.id === node.parentId);
    setPosition(node.id, {
      x: node.position.x + (parent?.position.x ?? 0),
      y: node.position.y + (parent?.position.y ?? 0),
    });
  };

  const hasFiles = (event: DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types).includes('Files');

  const handleDragEnter = (event: DragEvent<HTMLElement>): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>): void => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const handleDrop = async (event: DragEvent<HTMLElement>): Promise<void> => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    const targetNodeId = selectedNodeId;
    const position = flowInstance.current?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    }) ?? { x: event.clientX, y: event.clientY };

    try {
      const prepared = await prepareDroppedFiles(files);
      const uploaded = await Promise.all(
        prepared.map((file) => uploadAttachment(file.file)),
      );
      const createdAt = new Date().toISOString();
      addFileContexts({
        createdAt,
        files: prepared.map((file, index) => ({
          attachment: uploaded[index] as AttachmentDescriptor,
          blockId: createPortableId('block'),
          edgeId: targetNodeId === null ? null : createPortableId('edge'),
          file,
          nodeId: createPortableId('node'),
          position: { x: position.x, y: position.y + index * 180 },
          revisionId: createPortableId('revision'),
        })),
        targetNodeId,
      });
      setDropStatus(
        targetNodeId === null
          ? `Created ${String(prepared.length)} file context ${prepared.length === 1 ? 'node' : 'nodes'}.`
          : `Connected ${String(prepared.length)} ${prepared.length === 1 ? 'file' : 'files'} to ${graph.nodes[targetNodeId]?.title ?? 'the selected node'}.`,
      );
    } catch (cause) {
      setDropStatus(
        cause instanceof Error
          ? cause.message
          : 'The files could not be added.',
      );
    }
  };

  return (
    <section
      className={`graph-canvas${dragActive ? ' is-file-drag-active' : ''}`}
      aria-label="Conversation graph canvas"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={(event) => void handleDrop(event)}
    >
      <ReactFlow<WaterLilyFlowNode>
        colorMode="light"
        edges={edges}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        maxZoom={1.5}
        minZoom={0.2}
        nodes={nodes}
        nodesConnectable={false}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flowInstance.current = instance;
        }}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => {
          selectNode(null);
        }}
        proOptions={{ hideAttribution: false }}
      >
        <Background
          color="#cac7bb"
          gap={24}
          size={1.2}
          variant={BackgroundVariant.Dots}
        />
        <MiniMap
          ariaLabel="Conversation graph overview"
          maskColor="rgba(247, 245, 237, 0.72)"
          nodeColor={(node) => miniMapColor(node as WaterLilyFlowNode)}
          pannable
          zoomable
        />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
      {dragActive ? (
        <div className="file-drop-overlay" role="status">
          <strong>Connect files to this context</strong>
          <span>
            {selectedNodeId === null
              ? 'Release to create standalone context nodes'
              : `Release to connect to ${graph.nodes[selectedNodeId]?.title ?? 'the selected node'}`}
          </span>
        </div>
      ) : null}
      {dropStatus === null ? null : (
        <div className="file-drop-status" role="status">
          {dropStatus}
        </div>
      )}
    </section>
  );
}
