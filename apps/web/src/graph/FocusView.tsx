import type { GraphNode, GraphSnapshot } from '@waterlily/domain';
import { GitMerge, MessageSquareText } from 'lucide-react';

import { contextThread, nodeTitle, revisionText } from './graphViewModel';

export interface FocusViewProps {
  readonly graph: GraphSnapshot;
  readonly headNodeId: string | null;
  readonly onSelectNode: (nodeId: string) => void;
}

export function FocusView({ graph, headNodeId, onSelectNode }: FocusViewProps) {
  if (headNodeId === null) {
    return (
      <section className="focus-empty" aria-labelledby="focus-empty-title">
        <MessageSquareText aria-hidden="true" size={28} />
        <h2 id="focus-empty-title">Choose a head to read</h2>
        <p>Select a node on the canvas, then return to focus mode.</p>
      </section>
    );
  }

  const nodeIds = contextThread(graph, headNodeId);
  return (
    <section className="focus-view" aria-label="Selected conversation thread">
      <header className="focus-view__intro">
        <span>Reading path</span>
        <h1>{nodeTitle(graph, headNodeId)}</h1>
        <p>{nodeIds.length} context nodes · shared ancestry appears once</p>
      </header>
      <ol className="focus-thread">
        {nodeIds.map((nodeId) => {
          const node = graph.nodes[nodeId] as GraphNode;
          const category = node.role ?? node.kind;
          return (
            <li key={nodeId} className={`focus-card focus-card--${category}`}>
              <button
                type="button"
                className="focus-card__body"
                onClick={() => {
                  onSelectNode(nodeId);
                }}
              >
                <span className="focus-card__meta">
                  <span>{category}</span>
                  {nodeId === headNodeId ? (
                    <strong>Selected head</strong>
                  ) : null}
                </span>
                <strong className="focus-card__title">
                  {nodeTitle(graph, nodeId)}
                </strong>
                <span className="focus-card__text">
                  {revisionText(graph, nodeId)}
                </span>
              </button>
              {nodeId === headNodeId && nodeIds.length > 1 ? (
                <span
                  className="focus-card__merge"
                  aria-label="End of selected path"
                >
                  <GitMerge aria-hidden="true" size={14} /> End of path
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
