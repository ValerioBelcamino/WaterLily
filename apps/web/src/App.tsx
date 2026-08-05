import '@xyflow/react/dist/style.css';
import './styles.css';

import {
  parseGraphDocument,
  type ImportEntityKind,
} from '@waterlily/interchange';
import {
  Download,
  Focus,
  FolderPlus,
  GitMerge,
  LayoutDashboard,
  Search,
  Upload,
} from 'lucide-react';
import { useState } from 'react';

import { useWaterLilyService } from './api/useWaterLilyService';
import { FocusView } from './graph/FocusView';
import { GraphCanvas } from './graph/GraphCanvas';
import { nodeTitle, revisionText } from './graph/graphViewModel';
import { Inspector } from './Inspector';
import { downloadGraph } from './interchange/downloadGraph';
import {
  OperationDialog,
  type OperationKind,
  type OperationSubmission,
} from './OperationDialog';
import { Sidebar } from './Sidebar';
import { useWaterLilyStore, type ViewMode } from './state/waterlilyStore';

function ModeButton({
  active,
  children,
  mode,
  onChange,
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
  readonly mode: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={active ? 'is-active' : undefined}
      onClick={() => {
        onChange(mode);
      }}
    >
      {children}
    </button>
  );
}

function createPortableId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function importId(kind: ImportEntityKind): string {
  return createPortableId(`import-${kind}`);
}

export function App() {
  const [dialog, setDialog] = useState<OperationKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const service = useWaterLilyService();
  const addGroup = useWaterLilyStore((state) => state.addGroup);
  const branch = useWaterLilyStore((state) => state.branch);
  const contextSelections = useWaterLilyStore(
    (state) => state.contextSelections,
  );
  const graph = useWaterLilyStore((state) => state.graph);
  const groups = useWaterLilyStore((state) => state.groups);
  const merge = useWaterLilyStore((state) => state.merge);
  const mergeDocument = useWaterLilyStore((state) => state.mergeDocument);
  const positions = useWaterLilyStore((state) => state.positions);
  const selectedNodeId = useWaterLilyStore((state) => state.selectedNodeId);
  const selectedNodeIds = useWaterLilyStore((state) => state.selectedNodeIds);
  const selectNode = useWaterLilyStore((state) => state.selectNode);
  const setContextSelection = useWaterLilyStore(
    (state) => state.setContextSelection,
  );
  const setViewMode = useWaterLilyStore((state) => state.setViewMode);
  const split = useWaterLilyStore((state) => state.split);
  const viewMode = useWaterLilyStore((state) => state.viewMode);
  const nodeCount = Object.keys(graph.nodes).length;
  const edgeCount = Object.keys(graph.edges).length;
  const selectedTitle =
    selectedNodeId === null
      ? 'No node selected'
      : nodeTitle(graph, selectedNodeId);
  const activeProvider = service.providers.find(
    (provider) => provider.id === service.selectedProviderId,
  );
  const generationActive = service.generation.status !== 'idle';
  const statusMessage =
    service.generation.status === 'saving'
      ? 'Saving the exact context snapshot…'
      : service.generation.status === 'streaming'
        ? 'Streaming a model response…'
        : (notice ??
          service.serviceError ??
          `${String(nodeCount)} nodes · ${String(edgeCount)} typed edges · local draft`);

  const submitOperation = (submission: OperationSubmission): void => {
    const createdAt = new Date().toISOString();
    if (submission.kind === 'import') {
      const document = parseGraphDocument(submission.json);
      mergeDocument(document, (kind) => importId(kind));
      setNotice(
        `Imported ${String(Object.keys(document.graph.nodes).length)} nodes.`,
      );
      return;
    }
    if (submission.kind === 'group') {
      addGroup({
        collapsed: false,
        color: submission.color,
        id: createPortableId('group'),
        nodeIds: selectedNodeIds,
        title: submission.title,
      });
      setNotice(`Grouped ${String(selectedNodeIds.length)} nodes.`);
      return;
    }
    if (selectedNodeId === null) throw new Error('Select a node first.');
    if (submission.kind === 'branch') {
      branch({
        edgeId: createPortableId('edge'),
        message: {
          blockId: createPortableId('block'),
          createdAt,
          nodeId: createPortableId('node'),
          revisionId: createPortableId('revision'),
          text: submission.text,
          title: submission.title,
        },
        parentNodeId: selectedNodeId,
      });
      setNotice('Branch created from the selected revision.');
      return;
    }
    if (submission.kind === 'merge') {
      if (selectedNodeIds.length < 2)
        throw new Error('Select at least two branch heads.');
      merge({
        edgeIds: selectedNodeIds.map(() => createPortableId('edge')),
        heads: selectedNodeIds.map((nodeId) => ({
          label: nodeTitle(graph, nodeId),
          nodeId,
        })),
        message: {
          blockId: createPortableId('block'),
          createdAt,
          nodeId: createPortableId('node'),
          revisionId: createPortableId('revision'),
          text: submission.text,
          title: submission.title,
        },
      });
      setNotice(`Merged ${String(selectedNodeIds.length)} branch heads.`);
      return;
    }
    const sourceNode = graph.nodes[selectedNodeId];
    const revision =
      sourceNode === undefined
        ? undefined
        : graph.revisions[sourceNode.currentRevisionId];
    if (revision === undefined)
      throw new Error('The selected revision is unavailable.');
    const sourceBlockIds = revision.blocks.map((block) => block.id);
    const inheritedContextCount = Object.values(graph.edges).filter(
      (edge) => edge.kind === 'context' && edge.targetNodeId === selectedNodeId,
    ).length;
    split({
      createdAt,
      parts: submission.parts.map((text, index) => ({
        blockId: createPortableId('block'),
        contextEdgeIds: Array.from({ length: inheritedContextCount }, () =>
          createPortableId('edge'),
        ),
        nodeId: createPortableId('node'),
        provenanceEdgeId: createPortableId('edge'),
        revisionId: createPortableId('revision'),
        sourceBlockIds,
        text,
        title:
          submission.titlePrefix === null
            ? `${selectedTitle} · Part ${String(index + 1)}`
            : `${submission.titlePrefix} ${String(index + 1)}`,
      })),
      sourceNodeId: selectedNodeId,
    });
    setNotice(
      `Created ${String(submission.parts.length)} independent excerpts.`,
    );
  };

  const exportCurrentGraph = async (): Promise<void> => {
    try {
      const hash = await downloadGraph({
        exportedAt: new Date().toISOString(),
        graph,
        view: { groups, positions },
      });
      setNotice(`Exported checksummed JSON · ${hash.slice(0, 10)}…`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Export failed.');
    }
  };

  return (
    <div className="waterlily-shell">
      <Sidebar edgeCount={edgeCount} nodeCount={nodeCount} />
      <main className="workspace">
        <header className="workspace__toolbar">
          <div className="workspace__title">
            <span className="eyebrow">Local-first graph · {graph.id}</span>
            <h1>Oxidative phosphorylation</h1>
          </div>
          <div className="mode-switcher" aria-label="Workspace view">
            <ModeButton
              active={viewMode === 'canvas'}
              mode="canvas"
              onChange={setViewMode}
            >
              <LayoutDashboard aria-hidden="true" size={15} /> Canvas
            </ModeButton>
            <ModeButton
              active={viewMode === 'focus'}
              mode="focus"
              onChange={setViewMode}
            >
              <Focus aria-hidden="true" size={15} /> Focus
            </ModeButton>
          </div>
          <div className="toolbar-actions">
            <div className="provider-control">
              <span
                className={`service-status service-status--${service.status}`}
                title={
                  service.serviceError ?? `Local service: ${service.status}`
                }
              >
                <span aria-hidden="true" />
                {service.status}
              </span>
              <label>
                <span className="sr-only">Model provider</span>
                <select
                  aria-label="Model provider"
                  disabled={service.providers.length === 0 || generationActive}
                  value={service.selectedProviderId ?? ''}
                  onChange={(event) =>
                    service.setSelectedProviderId(event.target.value)
                  }
                >
                  <option value="" disabled>
                    No provider
                  </option>
                  {service.providers.map((provider) => (
                    <option
                      key={provider.id}
                      disabled={!provider.available}
                      value={provider.id}
                    >
                      {provider.name}
                      {provider.available ? '' : ' · not configured'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" disabled title="Search coming soon">
              <Search aria-hidden="true" size={17} />
              <span className="sr-only">Search graph</span>
            </button>
            <button
              type="button"
              disabled={selectedNodeIds.length === 0}
              onClick={() => setDialog('group')}
            >
              <FolderPlus aria-hidden="true" size={17} /> Group
            </button>
            <button type="button" onClick={() => setDialog('import')}>
              <Upload aria-hidden="true" size={17} /> Import
            </button>
            <button type="button" onClick={() => void exportCurrentGraph()}>
              <Download aria-hidden="true" size={17} /> Export
            </button>
          </div>
        </header>

        <div className="workspace__body">
          <div className="workspace__surface">
            {viewMode === 'canvas' ? (
              <GraphCanvas graph={graph} />
            ) : (
              <FocusView
                graph={graph}
                headNodeId={selectedNodeId}
                onSelectNode={selectNode}
              />
            )}
            <div className="canvas-status" aria-live="polite">
              <GitMerge aria-hidden="true" size={14} />
              {statusMessage}
            </div>
          </div>
          <Inspector
            canGenerate={
              service.status === 'online' &&
              activeProvider?.available === true &&
              selectedNodeId !== null
            }
            contextSelection={
              selectedNodeId === null
                ? { mode: 'full' }
                : (contextSelections[selectedNodeId] ?? { mode: 'full' })
            }
            graph={graph}
            generation={service.generation}
            nodeId={selectedNodeId}
            onBranch={() => setDialog('branch')}
            onCancel={service.cancel}
            onContextSelectionChange={(selection) => {
              if (selectedNodeId !== null)
                setContextSelection(selectedNodeId, selection);
            }}
            onGenerate={() => {
              if (selectedNodeId !== null)
                void service.generate(selectedNodeId);
            }}
            onMerge={() => setDialog('merge')}
            onSplit={() => setDialog('split')}
            selectedCount={selectedNodeIds.length}
          />
        </div>
      </main>
      {dialog === null ? null : (
        <OperationDialog
          initialText={
            dialog === 'split' && selectedNodeId !== null
              ? revisionText(graph, selectedNodeId)
              : ''
          }
          kind={dialog}
          onClose={() => setDialog(null)}
          onSubmit={submitOperation}
          selectedCount={selectedNodeIds.length}
          selectedTitle={selectedTitle}
        />
      )}
    </div>
  );
}
