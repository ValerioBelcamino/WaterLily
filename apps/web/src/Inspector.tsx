import {
  extractTemplateVariables,
  type GraphSnapshot,
  type TextContentBlock,
} from '@waterlily/domain';
import type { ContextSelection } from '@waterlily/context-engine';
import {
  GitBranch,
  GitMerge,
  Code2,
  Pencil,
  Play,
  Save,
  Sparkles,
  Split,
  Square,
  Tag,
} from 'lucide-react';
import { useState } from 'react';

import type {
  GenerationViewState,
  PythonExecutionViewState,
} from './api/useWaterLilyService';
import { ContextMeter } from './ContextMeter';
import type { ContextMeterState } from './useContextMeter';
import { nodeTitle, revisionText } from './graph/graphViewModel';

export interface InspectorProps {
  readonly canGenerate: boolean;
  readonly canExecute: boolean;
  readonly execution: PythonExecutionViewState;
  readonly generation: GenerationViewState;
  readonly graph: GraphSnapshot;
  readonly contextSelection: ContextSelection;
  readonly contextMeter: ContextMeterState;
  readonly nodeId: string | null;
  readonly onBranch: () => void;
  readonly onBindVariable: (
    blockId: string,
    name: string,
    sourceNodeId: string,
  ) => void;
  readonly onCancel: () => void;
  readonly onCreateCode: () => void;
  readonly onContextSelectionChange: (selection: ContextSelection) => void;
  readonly onGenerate: () => void;
  readonly onRunCode: () => void;
  readonly onMerge: () => void;
  readonly onReviseText: (blockId: string, text: string) => void;
  readonly onSplit: () => void;
  readonly onUnbindVariable: (blockId: string, name: string) => void;
  readonly selectedCount: number;
}

export function Inspector({
  canExecute,
  canGenerate,
  contextMeter,
  contextSelection,
  generation,
  execution,
  graph,
  nodeId,
  onBranch,
  onBindVariable,
  onCancel,
  onCreateCode,
  onContextSelectionChange,
  onGenerate,
  onRunCode,
  onMerge,
  onReviseText,
  onSplit,
  onUnbindVariable,
  selectedCount,
}: InspectorProps) {
  const node = nodeId === null ? undefined : graph.nodes[nodeId];
  const revision =
    node === undefined ? undefined : graph.revisions[node.currentRevisionId];
  const firstTextBlock = revision?.blocks.find(
    (block): block is TextContentBlock => block.type === 'text',
  );
  const [editingRevisionId, setEditingRevisionId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [templateFailure, setTemplateFailure] = useState<{
    readonly message: string;
    readonly revisionId: string;
  } | null>(null);
  const editing = editingRevisionId === revision?.id;
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
  const editable =
    firstTextBlock !== undefined &&
    (node.kind === 'summary' ||
      node.kind === 'note' ||
      node.role === 'user' ||
      node.role === 'system');
  const templateVariables =
    firstTextBlock?.template === undefined
      ? []
      : extractTemplateVariables(firstTextBlock.text);

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
        {revision?.metadata.checkpoint === undefined ? null : (
          <span>context root</span>
        )}
      </div>
      {editing && firstTextBlock !== undefined ? (
        <div className="inspector__editor">
          <label htmlFor="inspector-text-editor">Editable content</label>
          <textarea
            autoFocus
            id="inspector-text-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <small>
            Variables use {'{{name}}'}. Write {'\\{{name}}'} for literal braces.
          </small>
          {editError === null ? null : <p role="alert">{editError}</p>}
          <div>
            <button
              type="button"
              onClick={() => {
                setEditingRevisionId(null);
                setDraft(firstTextBlock.text);
                setEditError(null);
              }}
            >
              Cancel
            </button>
            <button
              className="button--primary"
              type="button"
              onClick={() => {
                try {
                  onReviseText(firstTextBlock.id, draft);
                  setEditingRevisionId(null);
                  setEditError(null);
                } catch (cause) {
                  setEditError(
                    cause instanceof Error ? cause.message : 'Edit failed.',
                  );
                }
              }}
            >
              <Save aria-hidden="true" size={14} /> Save revision
            </button>
          </div>
        </div>
      ) : (
        <div className="inspector__content-wrap">
          <p
            className={`inspector__content${node.kind === 'code' || node.kind === 'execution' ? ' inspector__content--code' : ''}`}
          >
            {revisionText(graph, node.id)}
          </p>
          {editable ? (
            <button
              aria-label="Edit node content"
              type="button"
              onClick={() => {
                setDraft(firstTextBlock.text);
                setEditError(null);
                setEditingRevisionId(revision?.id ?? null);
              }}
            >
              <Pencil aria-hidden="true" size={14} /> Edit
            </button>
          ) : null}
        </div>
      )}
      {firstTextBlock === undefined || templateVariables.length === 0 ? null : (
        <section className="template-inputs">
          <header>
            <strong>Template inputs</strong>
            <span>{String(templateVariables.length)} pins</span>
          </header>
          {templateVariables.map((name) => {
            const binding = firstTextBlock.template?.bindings.find(
              (candidate) => candidate.name === name,
            );
            return (
              <label key={name}>
                <code>{`{{${name}}}`}</code>
                <select
                  aria-label={`Source for ${name}`}
                  value={binding?.sourceNodeId ?? ''}
                  onChange={(event) => {
                    try {
                      if (event.target.value.length === 0) {
                        if (binding !== undefined)
                          onUnbindVariable(firstTextBlock.id, name);
                      } else {
                        onBindVariable(
                          firstTextBlock.id,
                          name,
                          event.target.value,
                        );
                      }
                      setTemplateFailure(null);
                    } catch (cause) {
                      setTemplateFailure({
                        message:
                          cause instanceof Error
                            ? cause.message
                            : 'Template connection failed.',
                        revisionId: revision?.id ?? '',
                      });
                    }
                  }}
                >
                  <option value="">Unbound</option>
                  {Object.values(graph.nodes)
                    .filter((candidate) => {
                      const candidateRevision =
                        graph.revisions[candidate.currentRevisionId];
                      return (
                        candidate.deletedAt === null &&
                        candidateRevision?.blocks.some(
                          (block) => block.type === 'text',
                        ) === true
                      );
                    })
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {nodeTitle(graph, candidate.id)}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
          {templateFailure !== null &&
          templateFailure.revisionId === revision?.id ? (
            <p role="alert">{templateFailure.message}</p>
          ) : null}
        </section>
      )}
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
      <ContextMeter state={contextMeter} />
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
        {node.kind === 'code' ? (
          <button
            type="button"
            disabled={!canExecute && execution.status === 'idle'}
            onClick={execution.status === 'idle' ? onRunCode : onCancel}
            title="Replay included Python cells through this cell"
          >
            {execution.status === 'idle' ? (
              <Play aria-hidden="true" size={15} />
            ) : (
              <Square aria-hidden="true" size={15} />
            )}
            {execution.status === 'idle' ? 'Run' : 'Stop'}
          </button>
        ) : null}
        <button type="button" onClick={onCreateCode}>
          <Code2 aria-hidden="true" size={15} /> Code
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
      {execution.status !== 'idle' || execution.error !== null ? (
        <section className="generation-panel" aria-live="polite">
          <header>
            <strong>
              {execution.status === 'running'
                ? 'Running local Python'
                : 'Last Python run'}
            </strong>
          </header>
          {execution.error === null ? null : (
            <p className="generation-panel__error" role="alert">
              {execution.error}
            </p>
          )}
        </section>
      ) : null}
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
