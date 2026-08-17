import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createNode,
  reviseTextBlock,
  setTemplateBinding,
  type GraphNode,
} from '@waterlily/domain';

import { sampleGraph } from './sampleGraph';
import { Inspector } from './Inspector';

const emptyHandlers = {
  canExecute: true,
  canGenerate: true,
  contextSelection: { mode: 'full' } as const,
  contextMeter: {
    attachmentCount: 0,
    breakdown: [],
    budgetTokens: null,
    contextWindowTokens: null,
    error: null,
    estimatedTokens: 12,
    outputReserveTokens: 8_192,
    overflow: false,
    status: 'ready',
  } as const,
  generation: {
    error: null,
    model: null,
    reasoning: '',
    status: 'idle',
    text: '',
  } as const,
  execution: { error: null, result: null, status: 'idle' } as const,
  onBranch: () => undefined,
  onBindVariable: () => undefined,
  onCancel: () => undefined,
  onCreateCode: () => undefined,
  onContextSelectionChange: () => undefined,
  onGenerate: () => undefined,
  onRunCode: () => undefined,
  onMerge: () => undefined,
  onReviseText: () => undefined,
  onSplit: () => undefined,
  onUnbindVariable: () => undefined,
  selectedCount: 1,
};

describe('Inspector', () => {
  it('renders an explicit empty selection state', () => {
    render(<Inspector {...emptyHandlers} graph={sampleGraph} nodeId={null} />);
    expect(
      screen.getByRole('heading', { name: 'No node selected' }),
    ).toBeVisible();
  });

  it('shows the exact current revision and relationship counts', () => {
    render(
      <Inspector
        {...emptyHandlers}
        graph={sampleGraph}
        nodeId="node-synthesis"
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Merged understanding' }),
    ).toBeVisible();
    expect(screen.getByText('2', { selector: 'dd' })).toBeVisible();
    expect(screen.getByText('1', { selector: 'dd' })).toBeVisible();
    expect(screen.getByTitle('revision-node-synthesis')).toHaveTextContent(
      'r/synthesis',
    );
    expect(screen.getByRole('button', { name: /Branch/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Merge/ })).toBeDisabled();
  });

  it('dispatches graph operations and explicit context changes', async () => {
    const user = userEvent.setup();
    const onBranch = vi.fn();
    const onContextSelectionChange = vi.fn();
    const onGenerate = vi.fn();
    const onMerge = vi.fn();
    const onSplit = vi.fn();
    render(
      <Inspector
        canExecute
        canGenerate
        contextSelection={{ mode: 'excluded' }}
        contextMeter={emptyHandlers.contextMeter}
        generation={emptyHandlers.generation}
        execution={emptyHandlers.execution}
        graph={sampleGraph}
        nodeId="node-answer"
        onBranch={onBranch}
        onBindVariable={emptyHandlers.onBindVariable}
        onCancel={() => undefined}
        onCreateCode={() => undefined}
        onContextSelectionChange={onContextSelectionChange}
        onGenerate={onGenerate}
        onRunCode={() => undefined}
        onMerge={onMerge}
        onReviseText={emptyHandlers.onReviseText}
        onSplit={onSplit}
        onUnbindVariable={emptyHandlers.onUnbindVariable}
        selectedCount={2}
      />,
    );

    expect(screen.getByRole('button', { name: 'Excluded' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(screen.getByRole('button', { name: /Branch/ }));
    await user.click(screen.getByRole('button', { name: /Generate/ }));
    await user.click(screen.getByRole('button', { name: /Split/ }));
    await user.click(screen.getByRole('button', { name: /Merge/ }));
    await user.click(screen.getByRole('button', { name: 'Excluded' }));
    expect(onBranch).toHaveBeenCalledOnce();
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onSplit).toHaveBeenCalledOnce();
    expect(onMerge).toHaveBeenCalledOnce();
    expect(onContextSelectionChange).toHaveBeenCalledWith({ mode: 'full' });
  });

  it('shows streamed output and switches generation to a stop action', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <Inspector
        {...emptyHandlers}
        generation={{
          error: null,
          model: 'deepseek-v4-flash',
          reasoning: 'Inspect the proton gradient.',
          status: 'streaming',
          text: 'ATP synthase rotates.',
        }}
        graph={sampleGraph}
        nodeId="node-answer"
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('Generating response')).toBeVisible();
    expect(screen.getByText('Public reasoning')).toBeVisible();
    expect(screen.getByText('ATP synthase rotates.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Stop/ }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('saves edited summaries as new revisions', async () => {
    const user = userEvent.setup();
    const onReviseText = vi.fn();
    render(
      <Inspector
        {...emptyHandlers}
        graph={sampleGraph}
        nodeId="node-synthesis"
        onReviseText={onReviseText}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit node content' }));
    fireEvent.change(screen.getByLabelText('Editable content'), {
      target: { value: 'Condensed and editable.' },
    });
    await user.click(screen.getByRole('button', { name: /Save revision/ }));
    expect(onReviseText).toHaveBeenCalledWith(
      'block-node-synthesis',
      'Condensed and editable.',
    );
  });

  it('cancels edits and surfaces revision failures', async () => {
    const user = userEvent.setup();
    const view = render(
      <Inspector
        {...emptyHandlers}
        graph={sampleGraph}
        nodeId="node-synthesis"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit node content' }));
    fireEvent.change(screen.getByLabelText('Editable content'), {
      target: { value: 'Discard this' },
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/Synthesis: electron transport/)).toBeVisible();

    view.rerender(
      <Inspector
        {...emptyHandlers}
        graph={sampleGraph}
        nodeId="node-synthesis"
        onReviseText={() => {
          throw new Error('Revision collision');
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit node content' }));
    await user.click(screen.getByRole('button', { name: /Save revision/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Revision collision');
  });

  it('binds and unbinds graph nodes through visible template inputs', async () => {
    const user = userEvent.setup();
    const onBindVariable = vi.fn();
    const onUnbindVariable = vi.fn();
    const graph = reviseTextBlock(sampleGraph, {
      blockId: 'block-node-note',
      createdAt: '2026-08-17T10:00:00.000Z',
      nodeId: 'node-note',
      revisionId: 'revision-note-template',
      text: 'Apply {{mechanism}}',
    });
    const view = render(
      <Inspector
        {...emptyHandlers}
        graph={graph}
        nodeId="node-note"
        onBindVariable={onBindVariable}
        onUnbindVariable={onUnbindVariable}
      />,
    );
    expect(screen.getByText('1 pins')).toBeVisible();
    const source = screen.getByLabelText('Source for mechanism');
    fireEvent.change(source, { target: { value: '' } });
    expect(onUnbindVariable).not.toHaveBeenCalled();
    await user.selectOptions(source, 'node-answer');
    expect(onBindVariable).toHaveBeenCalledWith(
      'block-node-note',
      'mechanism',
      'node-answer',
    );
    expect(onUnbindVariable).not.toHaveBeenCalled();
    const bound = setTemplateBinding(graph, {
      createdAt: '2026-08-17T10:00:01.000Z',
      name: 'mechanism',
      nodeId: 'node-note',
      revisionId: 'revision-note-bound',
      sourceNodeId: 'node-answer',
      targetBlockId: 'block-node-note',
    });
    view.rerender(
      <Inspector
        {...emptyHandlers}
        graph={bound}
        nodeId="node-note"
        onBindVariable={onBindVariable}
        onUnbindVariable={onUnbindVariable}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Source for mechanism'), '');
    expect(onUnbindVariable).toHaveBeenCalledWith(
      'block-node-note',
      'mechanism',
    );

    view.rerender(
      <Inspector
        {...emptyHandlers}
        graph={bound}
        nodeId="node-note"
        onBindVariable={() => {
          throw new Error('Binding cycle');
        }}
      />,
    );
    await user.selectOptions(
      screen.getByLabelText('Source for mechanism'),
      'node-side-answer',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Binding cycle');
  });

  it('disables generation without a configured local provider and shows errors', () => {
    render(
      <Inspector
        {...emptyHandlers}
        canGenerate={false}
        generation={{
          ...emptyHandlers.generation,
          error: 'Provider unavailable',
        }}
        graph={sampleGraph}
        nodeId="node-answer"
      />,
    );

    expect(screen.getByRole('button', { name: /Generate/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
  });

  it('treats unknown identifiers as an empty selection', () => {
    render(
      <Inspector {...emptyHandlers} graph={sampleGraph} nodeId="not-here" />,
    );
    expect(
      screen.getByRole('heading', { name: 'No node selected' }),
    ).toBeVisible();
  });

  it('surfaces tags and a missing revision without crashing', () => {
    const graph = {
      ...sampleGraph,
      nodes: {
        ...sampleGraph.nodes,
        'node-note': {
          ...(sampleGraph.nodes['node-note'] as GraphNode),
          tags: ['analogy', 'review'],
        },
      },
      revisions: Object.fromEntries(
        Object.entries(sampleGraph.revisions).filter(
          ([revisionId]) => revisionId !== 'revision-node-note',
        ),
      ),
    };
    render(<Inspector {...emptyHandlers} graph={graph} nodeId="node-note" />);

    expect(screen.getByText('analogy, review')).toBeVisible();
    expect(screen.getByText('missing', { selector: 'dd' })).toBeVisible();
  });

  it('runs Python cells, creates follow-up cells, and exposes execution errors', async () => {
    const user = userEvent.setup();
    const onCreateCode = vi.fn();
    const onRunCode = vi.fn();
    const graph = createNode(sampleGraph, {
      blocks: [
        {
          format: 'plain',
          id: 'block-code-test',
          text: 'print(42)',
          type: 'text',
        },
      ],
      createdAt: '2026-08-17T10:00:00.000Z',
      kind: 'code',
      nodeId: 'node-code-test',
      revisionId: 'revision-code-test',
      title: 'Answer cell',
    });
    render(
      <Inspector
        {...emptyHandlers}
        execution={{
          error: 'Interpreter unavailable',
          result: null,
          status: 'idle',
        }}
        graph={graph}
        nodeId="node-code-test"
        onCreateCode={onCreateCode}
        onRunCode={onRunCode}
      />,
    );
    expect(screen.getByText('print(42)')).toHaveClass(
      'inspector__content--code',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Interpreter unavailable',
    );
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await user.click(screen.getByRole('button', { name: 'Code' }));
    expect(onRunCode).toHaveBeenCalledOnce();
    expect(onCreateCode).toHaveBeenCalledOnce();
  });

  it('shows running execution and context-saving generation states', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const graph = createNode(sampleGraph, {
      blocks: [
        {
          format: 'plain',
          id: 'block-code-running',
          text: 'print(42)',
          type: 'text',
        },
      ],
      createdAt: '2026-08-17T10:00:00.000Z',
      kind: 'code',
      nodeId: 'node-code-running',
      revisionId: 'revision-code-running',
    });
    render(
      <Inspector
        {...emptyHandlers}
        execution={{ error: null, result: null, status: 'running' }}
        generation={{
          error: null,
          model: 'model-test',
          reasoning: '',
          status: 'saving',
          text: '',
        }}
        graph={graph}
        nodeId="node-code-running"
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText('Running local Python')).toBeVisible();
    expect(screen.getByText('Saving context')).toBeVisible();
    const stop = screen.getAllByRole('button', { name: /Stop/ })[1];
    if (stop === undefined) throw new TypeError('fixture');
    await user.click(stop);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
