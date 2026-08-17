import type { ModelDescriptor } from '@waterlily/api-contract';
import { reviseTextBlock } from '@waterlily/domain';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { sampleGraph } from './sampleGraph';
import { ContextMeter } from './ContextMeter';
import { useContextMeter } from './useContextMeter';

function model(contextWindowTokens: number | null): ModelDescriptor {
  return {
    capabilities: {
      inputExtensions: [],
      inputMimeTypes: [],
      maxFileBytes: null,
      nativeFiles: false,
    },
    contextWindowTokens,
    id: 'model-test',
    maxOutputTokens: 1,
    name: 'Test model',
  };
}

describe('context meter', () => {
  it('estimates the selected compiled flow and exposes a per-node breakdown', async () => {
    const heads = ['node-synthesis'];
    const selections = { 'node-answer': { mode: 'excluded' as const } };
    const selectedModel = model(4_096);
    const { result } = renderHook(() =>
      useContextMeter(sampleGraph, heads, selections, selectedModel),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({
      attachmentCount: 0,
      budgetTokens: 4_095,
      contextWindowTokens: 4_096,
      error: null,
      outputReserveTokens: 1,
      overflow: false,
    });
    expect(result.current.estimatedTokens).toBeGreaterThan(0);
    expect(result.current.breakdown.map((item) => item.nodeId)).not.toContain(
      'node-answer',
    );

    render(<ContextMeter state={result.current} />);
    expect(screen.getByText('Context meter')).toBeVisible();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '4095');
    expect(screen.getByText('Per-node estimate')).toBeVisible();
  });

  it('reports overflow while still showing the measured estimate', async () => {
    const heads = ['node-synthesis'];
    const selections = {};
    const selectedModel = model(2);
    const { result } = renderHook(() =>
      useContextMeter(sampleGraph, heads, selections, selectedModel),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({
      budgetTokens: 1,
      error: null,
      overflow: true,
    });
    expect(result.current.estimatedTokens).toBeGreaterThan(1);
    const { container } = render(<ContextMeter state={result.current} />);
    expect(container.querySelector('.context-meter--danger')).not.toBeNull();
  });

  it('stays hidden when no graph head is selected', () => {
    const heads: readonly string[] = [];
    const selections = {};
    const { result } = renderHook(() =>
      useContextMeter(sampleGraph, heads, selections, null),
    );
    expect(result.current.status).toBe('idle');
    const { container } = render(<ContextMeter state={result.current} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders estimating, unknown-limit, warning, file, and error states', () => {
    const base = {
      attachmentCount: 1,
      breakdown: [],
      budgetTokens: null,
      contextWindowTokens: null,
      error: null,
      estimatedTokens: null,
      outputReserveTokens: 8_192,
      overflow: false,
      status: 'estimating' as const,
    };
    const view = render(<ContextMeter state={base} />);
    expect(screen.getByText('Estimating…')).toBeVisible();
    expect(screen.getByText(/model limit unknown/)).toHaveTextContent(
      '1 native file not tokenized',
    );
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();

    view.rerender(
      <ContextMeter
        state={{
          ...base,
          attachmentCount: 2,
          budgetTokens: 10,
          contextWindowTokens: 11,
          estimatedTokens: 9,
          outputReserveTokens: 1,
          status: 'ready',
        }}
      />,
    );
    expect(
      view.container.querySelector('.context-meter--warning'),
    ).not.toBeNull();
    expect(screen.getByText(/2 native files not tokenized/)).toBeVisible();

    view.rerender(
      <ContextMeter
        state={{
          ...base,
          error: 'Template input missing',
          status: 'ready',
        }}
      />,
    );
    expect(screen.getByText('Incomplete')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Template input missing',
    );

    view.rerender(
      <ContextMeter
        state={{
          ...base,
          budgetTokens: 10,
          contextWindowTokens: 11,
          status: 'ready',
        }}
      />,
    );
    expect(screen.getByText('~0 tokens')).toBeVisible();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText(/0 \/ 10 input budget/)).toBeVisible();
  });

  it('reports template compilation errors and ignores canceled estimates', async () => {
    const heads = ['node-note'];
    const selections = {};
    const unbound = reviseTextBlock(sampleGraph, {
      blockId: 'block-node-note',
      createdAt: '2026-08-17T10:00:00.000Z',
      nodeId: 'node-note',
      revisionId: 'revision-note-unbound',
      text: 'Use {{missing}}',
    });
    const failed = renderHook(() =>
      useContextMeter(unbound, heads, selections, null),
    );
    await waitFor(() => expect(failed.result.current.status).toBe('ready'));
    expect(failed.result.current.error).toContain('not connected');

    const canceled = renderHook(() =>
      useContextMeter(sampleGraph, ['node-synthesis'], {}, null),
    );
    canceled.unmount();
    await Promise.resolve();
  });
});
