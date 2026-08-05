import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import { useMemo } from 'react';

import { useWaterLilyStore } from '../state/waterlilyStore';
import { CanvasGroupNode } from './CanvasGroupNode';
import { ConversationNode } from './ConversationNode';
import {
  toFlowEdges,
  toFlowNodes,
  type WaterLilyFlowNode,
} from './graphViewModel';
import type { GraphSnapshot } from '@waterlily/domain';

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
  readonly graph: GraphSnapshot;
}

export function GraphCanvas({ graph }: GraphCanvasProps) {
  const positions = useWaterLilyStore((state) => state.positions);
  const contextSelections = useWaterLilyStore(
    (state) => state.contextSelections,
  );
  const groups = useWaterLilyStore((state) => state.groups);
  const selectedNodeIds = useWaterLilyStore((state) => state.selectedNodeIds);
  const selectNode = useWaterLilyStore((state) => state.selectNode);
  const setPosition = useWaterLilyStore((state) => state.setPosition);
  const setPositions = useWaterLilyStore((state) => state.setPositions);
  const nodes = useMemo(
    () =>
      toFlowNodes(graph, {
        contextSelections,
        groups,
        positions,
        selectedNodeIds,
      }),
    [contextSelections, graph, groups, positions, selectedNodeIds],
  );
  const edges = useMemo(() => toFlowEdges(graph), [graph]);

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

  return (
    <section className="graph-canvas" aria-label="Conversation graph canvas">
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
    </section>
  );
}
