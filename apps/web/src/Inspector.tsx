import type { GraphSnapshot } from '@llm-graph/domain';
import type { ContextSelection } from '@llm-graph/context-engine';
import {
  GitBranch,
  GitMerge,
  Sparkles,
  Split,
  Square,
  Tag,
} from 'lucide-react';

import type { GenerationViewState } from './api/useWorkbenchService';
import { nodeTitle, revisionText } from './graph/graphViewModel';

export interface InspectorProps {
  readonly canGenerate: boolean;
  readonly generation: GenerationViewState;
  readonly graph: GraphSnapshot;
  readonly contextSelection: ContextSelection;
  readonly nodeId: string | null;
  readonly onBranch: () => void;
  readonly onCancel: () => void;
  readonly onContextSelectionChange: (selection: ContextSelection) => void;
  readonly onGenerate: () => void;
  readonly onMerge: () => void;
  readonly onSplit: () => void;
  readonly selectedCount: number;
}

export function Inspector({
  canGenerate,
  contextSelection,
  generation,
  graph,
  nodeId,
  onBranch,
  onCancel,
  onContextSelectionChange,
  onGenerate,
  onMerge,
  onSplit,
  selectedCount,
}: InspectorProps) {
  const node = nodeId === null ? undefined : graph.nodes[nodeId];
  if (node === undefined) {
    return (
      <aside className="inspector inspector--empty" aria-label="Node inspector">
        <span className="eyebrow">Inspector</span>
        <h2>No node selected</h2>
        <p>
          Select a node to inspect its exact revision, role, and graph
          relationships.
        </p>
      </aside>
    );
  }

  const inbound = Object.values(graph.edges).filter(
    (edge) => edge.targetNodeId === node.id,
  ).length;
  const outbound = Object.values(graph.edges).filter(
    (edge) => edge.sourceNodeId === node.id,
  ).length;
  const revision = graph.revisions[node.currentRevisionId];

  return (
    <aside className="inspector" aria-label="Node inspector">
      <div className="inspector__heading">
        <span className="eyebrow">Selected node</span>
        <span
          className={`role-dot role-dot--${node.role ?? node.kind}`}
          aria-hidden="true"
        />
      </div>
      <h2>{nodeTitle(graph, node.id)}</h2>
      <div className="inspector__chips" aria-label="Node attributes">
        <span>{node.role ?? 'document'}</span>
        <span>{node.kind}</span>
      </div>
      <p className="inspector__content">{revisionText(graph, node.id)}</p>
      <dl className="inspector__facts">
        <div>
          <dt>Incoming</dt>
          <dd>{inbound}</dd>
        </div>
        <div>
          <dt>Outgoing</dt>
          <dd>{outbound}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd title={revision?.id}>
            {revision?.id.replace('revision-node-', 'r/') ?? 'missing'}
          </dd>
        </div>
      </dl>
      <div className="context-control">
        <div>
          <strong>Model context</strong>
          <span>Explicit for future runs</span>
        </div>
        <button
          type="button"
          aria-pressed={contextSelection.mode !== 'excluded'}
          onClick={() => {
            onContextSelectionChange(
              contextSelection.mode === 'excluded'
                ? { mode: 'full' }
                : { mode: 'excluded' },
            );
          }}
        >
          {contextSelection.mode === 'excluded' ? 'Excluded' : 'Included'}
        </button>
      </div>
      <div className="inspector__actions" aria-label="Node actions">
        <button
          type="button"
          disabled={!canGenerate && generation.status === 'idle'}
          onClick={generation.status === 'idle' ? onGenerate : onCancel}
          title={
            generation.status === 'idle'
              ? canGenerate
                ? 'Generate a response from this context head'
                : 'Start the local service and configure a provider to generate'
              : 'Stop the active generation'
          }
        >
          {generation.status === 'idle' ? (
            <Sparkles aria-hidden="true" size={15} />
          ) : (
            <Square aria-hidden="true" size={15} />
          )}
          {generation.status === 'idle' ? 'Generate' : 'Stop'}
        </button>
        <button type="button" onClick={onBranch}>
          <GitBranch aria-hidden="true" size={15} /> Branch
        </button>
        <button type="button" onClick={onSplit}>
          <Split aria-hidden="true" size={15} /> Split
        </button>
        <button
          type="button"
          disabled={selectedCount < 2}
          onClick={onMerge}
          title={
            selectedCount < 2
              ? 'Shift-click at least two branch heads to merge'
              : `Merge ${String(selectedCount)} selected heads`
          }
        >
          <GitMerge aria-hidden="true" size={15} /> Merge
        </button>
      </div>
      {generation.status !== 'idle' ||
      generation.error !== null ||
      generation.reasoning.length > 0 ||
      generation.text.length > 0 ? (
        <section className="generation-panel" aria-live="polite">
          <header>
            <strong>
              {generation.status === 'saving'
                ? 'Saving context'
                : generation.status === 'streaming'
                  ? 'Generating response'
                  : 'Last generation'}
            </strong>
            {generation.model === null ? null : (
              <span title={generation.model}>{generation.model}</span>
            )}
          </header>
          {generation.reasoning.length === 0 ? null : (
            <details>
              <summary>Public reasoning</summary>
              <p>{generation.reasoning}</p>
            </details>
          )}
          {generation.text.length === 0 ? null : (
            <p className="generation-panel__text">{generation.text}</p>
          )}
          {generation.error === null ? null : (
            <p className="generation-panel__error" role="alert">
              {generation.error}
            </p>
          )}
        </section>
      ) : null}
      {node.tags.length > 0 ? (
        <div className="inspector__tags">
          <Tag aria-hidden="true" size={14} /> {node.tags.join(', ')}
        </div>
      ) : null}
    </aside>
  );
}
