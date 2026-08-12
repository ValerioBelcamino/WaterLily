import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createGraphDocument,
  serializeGraphDocument,
} from '@llm-graph/interchange';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useWorkbenchService,
  type WorkbenchServiceState,
} from './api/useWorkbenchService';
import { App } from './App';
import { sampleGraph } from './sampleGraph';
import { useWorkbenchStore } from './state/workbenchStore';

vi.mock('./api/useWorkbenchService', () => ({ useWorkbenchService: vi.fn() }));

function serviceState(
  overrides: Partial<WorkbenchServiceState> = {},
): WorkbenchServiceState {
  return {
    cancel: vi.fn(),
    generate: vi.fn(() => Promise.resolve()),
    generation: {
      error: null,
      model: null,
      reasoning: '',
      status: 'idle',
      text: '',
    },
    providers: [],
    selectedProviderId: null,
    serviceError: null,
    setSelectedProviderId: vi.fn(),
    status: 'disabled',
    ...overrides,
  };
}

describe('App', () => {
  beforeEach(() => {
    useWorkbenchStore.getState().reset();
    vi.mocked(useWorkbenchService).mockReturnValue(serviceState());
  });

  it('presents graph metadata and the selected node on the canvas', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Oxidative phosphorylation' }),
    ).toBeVisible();
    expect(
      screen.getByText('7 nodes · 8 typed edges · local draft'),
    ).toBeVisible();
    expect(
      screen.getByRole('complementary', { name: 'Node inspector' }),
    ).toHaveTextContent('Merged understanding');
    expect(screen.getByRole('button', { name: /Canvas/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switches to focus mode and follows selection changes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Focus/ }));
    expect(
      screen.getByRole('region', { name: 'Selected conversation thread' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Core question/ }));
    expect(
      screen.getByRole('complementary', { name: 'Node inspector' }),
    ).toHaveTextContent('Core question');
    expect(useWorkbenchStore.getState().selectedNodeId).toBe('node-question');
  });

  it('branches and toggles the selected node context explicitly', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Branch/ }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Branch from node');
    await user.type(
      screen.getByLabelText('Message'),
      'Why does oxygen matter?',
    );
    await user.click(screen.getByRole('button', { name: 'Branch from node' }));

    const state = useWorkbenchStore.getState();
    expect(Object.keys(state.graph.nodes)).toHaveLength(8);
    expect(Object.keys(state.graph.edges)).toHaveLength(9);
    expect(state.graph.nodes[state.selectedNodeId ?? '']).toMatchObject({
      role: 'user',
    });
    expect(
      screen.getByText('Branch created from the selected revision.'),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Included' }));
    expect(
      useWorkbenchStore.getState().contextSelections[
        state.selectedNodeId ?? ''
      ],
    ).toEqual({ mode: 'excluded' });
    expect(screen.getByRole('button', { name: 'Excluded' })).toBeVisible();
  });

  it('splits a node into provenance-linked excerpts with inherited context', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Split/ }));
    await user.clear(screen.getByLabelText('Excerpts'));
    await user.type(
      screen.getByLabelText('Excerpts'),
      'Synthesis: electron transport builds both parts of the proton-motive force\n---\nATP synthase converts their combined potential into chemical energy.',
    );
    await user.click(
      screen.getByRole('button', { name: 'Split node into excerpts' }),
    );

    const state = useWorkbenchStore.getState();
    expect(Object.keys(state.graph.nodes)).toHaveLength(9);
    expect(state.selectedNodeIds).toHaveLength(2);
    expect(
      state.selectedNodeIds.map((nodeId) => state.graph.nodes[nodeId]?.kind),
    ).toEqual(['excerpt', 'excerpt']);
    expect(
      Object.values(state.graph.edges).filter(
        (edge) =>
          edge.kind === 'provenance' &&
          state.selectedNodeIds.includes(edge.targetNodeId),
      ),
    ).toHaveLength(2);
  });

  it('merges a shift-style multi-selection in its explicit order', async () => {
    const user = userEvent.setup();
    useWorkbenchStore.getState().selectNode('node-answer');
    useWorkbenchStore.getState().selectNode('node-side-answer', true);
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Merge/ }));
    expect(screen.getByText('2 selected nodes')).toBeVisible();
    await user.type(
      screen.getByLabelText('Message'),
      'Compare both mechanisms.',
    );
    await user.click(
      screen.getByRole('button', { name: 'Merge selected branches' }),
    );

    const state = useWorkbenchStore.getState();
    const mergeNodeId = state.selectedNodeId;
    expect(mergeNodeId).not.toBeNull();
    expect(
      Object.values(state.graph.edges)
        .filter(
          (edge) =>
            edge.kind === 'context' && edge.targetNodeId === mergeNodeId,
        )
        .map((edge) => edge.kind === 'context' && edge.slot),
    ).toEqual([0, 1]);
  });

  it('groups a multi-selection and imports a remapped graph document', async () => {
    const user = userEvent.setup();
    useWorkbenchStore.getState().selectNode('node-answer');
    useWorkbenchStore.getState().selectNode('node-side-answer', true);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Group' }));
    await user.type(screen.getByLabelText('Group name'), 'Exam review');
    await user.click(
      screen.getByRole('button', { name: 'Group selected nodes' }),
    );
    expect(useWorkbenchStore.getState().groups[0]).toMatchObject({
      nodeIds: ['node-answer', 'node-side-answer'],
      title: 'Exam review',
    });

    const document = createGraphDocument({
      exportedAt: '2026-08-05T16:00:00.000Z',
      exporter: { name: 'App test', version: '1' },
      graph: sampleGraph,
    });
    await user.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.change(screen.getByLabelText('Graph document'), {
      target: { value: serializeGraphDocument(document) },
    });
    await user.click(screen.getByRole('button', { name: 'Validate & import' }));

    expect(Object.keys(useWorkbenchStore.getState().graph.nodes)).toHaveLength(
      14,
    );
    expect(screen.getByText('Imported 7 nodes.')).toBeVisible();
  });

  it('shows online providers and delegates provider selection', async () => {
    const user = userEvent.setup();
    const generate = vi.fn(() => Promise.resolve());
    const setSelectedProviderId = vi.fn();
    vi.mocked(useWorkbenchService).mockReturnValue(
      serviceState({
        providers: [
          {
            available: true,
            defaultModel: 'deepseek-v4-flash',
            id: 'deepseek',
            name: 'DeepSeek',
          },
          {
            available: true,
            defaultModel: 'local-model',
            id: 'local',
            name: 'Local model',
          },
        ],
        generate,
        selectedProviderId: 'deepseek',
        setSelectedProviderId,
        status: 'online',
      }),
    );
    render(<App />);

    expect(screen.getByText('online')).toBeVisible();
    expect(screen.getByRole('button', { name: /Generate/ })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Generate/ }));
    expect(generate).toHaveBeenCalledWith('node-synthesis');
    await user.selectOptions(screen.getByLabelText('Model provider'), 'local');
    expect(setSelectedProviderId).toHaveBeenCalledWith('local');
  });

  it('surfaces service errors and delegates active-generation cancellation', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    vi.mocked(useWorkbenchService).mockReturnValue(
      serviceState({
        cancel,
        generation: {
          error: null,
          model: 'local-model',
          reasoning: '',
          status: 'streaming',
          text: 'Partial answer',
        },
        providers: [
          {
            available: true,
            defaultModel: 'local-model',
            id: 'local',
            name: 'Local model',
          },
        ],
        selectedProviderId: 'local',
        status: 'online',
      }),
    );
    const rendered = render(<App />);

    expect(screen.getByText('Streaming a model response…')).toBeVisible();
    expect(screen.getByLabelText('Model provider')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Stop/ }));
    expect(cancel).toHaveBeenCalledOnce();

    vi.mocked(useWorkbenchService).mockReturnValue(
      serviceState({
        serviceError: 'Local service unavailable',
        status: 'offline',
      }),
    );
    rendered.rerender(<App />);
    expect(screen.getByText('Local service unavailable')).toBeVisible();
  });
});
