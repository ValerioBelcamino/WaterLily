import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createNode, type GraphNode } from '@waterlily/domain';

import { sampleGraph } from './sampleGraph';
import { Inspector } from './Inspector';

const emptyHandlers = {
  canExecute: true,
  canGenerate: true,
  contextSelection: { mode: 'full' } as const,
  generation: {
    error: null,
    model: null,
    reasoning: '',
    status: 'idle',
    text: '',
  } as const,
  execution: { error: null, result: null, status: 'idle' } as const,
  onBranch: () => undefined,
  onCancel: () => undefined,
  onCreateCode: () => undefined,
  onContextSelectionChange: () => undefined,
  onGenerate: () => undefined,
  onRunCode: () => undefined,
  onMerge: () => undefined,
  onSplit: () => undefined,
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
        generation={emptyHandlers.generation}
        execution={emptyHandlers.execution}
        graph={sampleGraph}
        nodeId="node-answer"
        onBranch={onBranch}
        onCancel={() => undefined}
        onCreateCode={() => undefined}
        onContextSelectionChange={onContextSelectionChange}
        onGenerate={onGenerate}
        onRunCode={() => undefined}
        onMerge={onMerge}
        onSplit={onSplit}
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
});
