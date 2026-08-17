import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createGraphDocument,
  serializeGraphDocument,
} from '@waterlily/interchange';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useWaterLilyService,
  type WaterLilyServiceState,
} from './api/useWaterLilyService';
import { App } from './App';
import { sampleGraph } from './sampleGraph';
import { useWaterLilyStore } from './state/waterlilyStore';

vi.mock('./api/useWaterLilyService', () => ({ useWaterLilyService: vi.fn() }));

function serviceState(
  overrides: Partial<WaterLilyServiceState> = {},
): WaterLilyServiceState {
  return {
    activeFlow: null,
    cancel: vi.fn(),
    createProviderProfile: vi.fn(() => Promise.resolve()),
    executePython: vi.fn(() => Promise.resolve()),
    execution: { error: null, result: null, status: 'idle' },
    generate: vi.fn(() => Promise.resolve()),
    generation: {
      error: null,
      model: null,
      reasoning: '',
      status: 'idle',
      text: '',
    },
    providers: [],
    removeProviderProfile: vi.fn(() => Promise.resolve()),
    selectedModelId: null,
    selectedProviderId: null,
    serviceError: null,
    setSelectedModelId: vi.fn(),
    setSelectedProviderId: vi.fn(),
    status: 'disabled',
    uploadAttachment: vi.fn(() => Promise.reject(new Error('Unavailable'))),
    ...overrides,
  };
}

function provider(
  id: string,
  name: string,
  modelId: string,
): WaterLilyServiceState['providers'][number] {
  return {
    available: true,
    defaultModel: modelId,
    id,
    models: [
      {
        capabilities: {
          inputExtensions: [],
          inputMimeTypes: [],
          maxFileBytes: null,
          nativeFiles: false,
        },
        id: modelId,
        name: modelId,
      },
    ],
    name,
    providerType: 'openai-compatible',
    source: 'environment',
  };
}

describe('App', () => {
  beforeEach(() => {
    useWaterLilyStore.getState().reset();
    vi.mocked(useWaterLilyService).mockReturnValue(serviceState());
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
    expect(useWaterLilyStore.getState().selectedNodeId).toBe('node-question');
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

    const state = useWaterLilyStore.getState();
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
      useWaterLilyStore.getState().contextSelections[
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

    const state = useWaterLilyStore.getState();
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
    useWaterLilyStore.getState().selectNode('node-answer');
    useWaterLilyStore.getState().selectNode('node-side-answer', true);
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

    const state = useWaterLilyStore.getState();
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
    useWaterLilyStore.getState().selectNode('node-answer');
    useWaterLilyStore.getState().selectNode('node-side-answer', true);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Group' }));
    await user.type(screen.getByLabelText('Group name'), 'Exam review');
    await user.click(
      screen.getByRole('button', { name: 'Group selected nodes' }),
    );
    expect(useWaterLilyStore.getState().groups[0]).toMatchObject({
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

    expect(Object.keys(useWaterLilyStore.getState().graph.nodes)).toHaveLength(
      14,
    );
    expect(screen.getByText('Imported 7 nodes.')).toBeVisible();
  });

  it('shows online providers and delegates provider selection', async () => {
    const user = userEvent.setup();
    const generate = vi.fn(() => Promise.resolve());
    const setSelectedModelId = vi.fn();
    const setSelectedProviderId = vi.fn();
    const deepseek = provider('deepseek', 'DeepSeek', 'deepseek-v4-flash');
    const deepseekCapabilities = deepseek.models[0]?.capabilities;
    if (deepseekCapabilities === undefined)
      throw new Error('Provider fixture requires a model');
    vi.mocked(useWaterLilyService).mockReturnValue(
      serviceState({
        providers: [
          {
            ...deepseek,
            models: [
              ...deepseek.models,
              {
                capabilities: deepseekCapabilities,
                id: 'deepseek-reasoner',
                name: 'DeepSeek Reasoner',
              },
            ],
          },
          provider('local', 'Local model', 'local-model'),
          {
            ...provider('offline', 'Offline provider', 'offline-model'),
            available: false,
          },
        ],
        generate,
        selectedModelId: 'deepseek-v4-flash',
        selectedProviderId: 'deepseek',
        setSelectedModelId,
        setSelectedProviderId,
        status: 'online',
      }),
    );
    render(<App />);

    expect(screen.getByText('online')).toBeVisible();
    expect(screen.getByRole('button', { name: /Generate/ })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Generate/ }));
    expect(generate).toHaveBeenCalledWith(['node-synthesis']);
    await user.selectOptions(screen.getByLabelText('Model provider'), 'local');
    expect(setSelectedProviderId).toHaveBeenCalledWith('local');
    await user.selectOptions(
      screen.getByLabelText('Model'),
      'deepseek-reasoner',
    );
    expect(setSelectedModelId).toHaveBeenCalledWith('deepseek-reasoner');
    expect(
      screen.getByRole('option', { name: /Offline provider/ }),
    ).toBeDisabled();
  });

  it('surfaces service errors and delegates active-generation cancellation', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    vi.mocked(useWaterLilyService).mockReturnValue(
      serviceState({
        cancel,
        generation: {
          error: null,
          model: 'local-model',
          reasoning: '',
          status: 'streaming',
          text: 'Partial answer',
        },
        providers: [provider('local', 'Local model', 'local-model')],
        selectedModelId: 'local-model',
        selectedProviderId: 'local',
        status: 'online',
      }),
    );
    const rendered = render(<App />);

    expect(screen.getByText('Streaming a model response…')).toBeVisible();
    expect(screen.getByLabelText('Model provider')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Stop/ }));
    expect(cancel).toHaveBeenCalledOnce();

    vi.mocked(useWaterLilyService).mockReturnValue(
      serviceState({
        serviceError: 'Local service unavailable',
        status: 'offline',
      }),
    );
    rendered.rerender(<App />);
    expect(screen.getByText('Local service unavailable')).toBeVisible();
  });

  it('adds a Python cell to the selected flow and delegates its execution', async () => {
    const user = userEvent.setup();
    const executePython = vi.fn(() => Promise.resolve());
    vi.mocked(useWaterLilyService).mockReturnValue(
      serviceState({ executePython, status: 'online' }),
    );
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Code' }));
    await user.type(screen.getByLabelText(/Cell title/), 'ATP calculation');
    await user.type(screen.getByLabelText('Python code'), 'print(6 * 7)');
    await user.click(screen.getByRole('button', { name: 'Add Python cell' }));

    const state = useWaterLilyStore.getState();
    const codeNodeId = state.selectedNodeId;
    expect(state.graph.nodes[codeNodeId ?? '']).toMatchObject({
      kind: 'code',
      title: 'ATP calculation',
    });
    expect(
      screen.getByText('Python cell added to the selected flow.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(executePython).toHaveBeenCalledWith(codeNodeId);
  });

  it('opens local credential management and delegates profile creation', async () => {
    const user = userEvent.setup();
    const createProviderProfile = vi.fn(() => Promise.resolve());
    vi.mocked(useWaterLilyService).mockReturnValue(
      serviceState({ createProviderProfile, status: 'online' }),
    );
    render(<App />);

    await user.click(
      screen.getByRole('button', { name: 'Manage provider profiles' }),
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Provider profiles',
    );
    await user.type(screen.getByLabelText('Profile name'), 'Personal');
    await user.type(screen.getByLabelText(/API key/), 'secret');
    await user.click(screen.getByRole('button', { name: 'Add profile' }));
    expect(createProviderProfile).toHaveBeenCalledWith({
      apiKey: 'secret',
      baseUrl: null,
      label: 'Personal',
      models: [],
      providerType: 'openai',
    });
  });
});
