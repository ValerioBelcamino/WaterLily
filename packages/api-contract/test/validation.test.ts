import { describe, expect, it } from 'vitest';
import { createNode } from '@waterlily/domain';

import {
  ApiContractError,
  parseCreateProviderProfileRequest,
  parseGenerationApiRequest,
  parseGenerationStreamLine,
  parsePythonExecutionRequest,
  parseWorkspaceSnapshot,
  parseWorkspaceWriteRequest,
  serializeNdjson,
  toWorkspaceSnapshot,
  validateWorkspaceState,
  type GenerationStreamItem,
} from '../src/index.js';
import {
  generationRequest,
  graphFixture,
  NOW,
  workspaceState,
} from './helpers.js';

function expectContractError(operation: () => unknown): void {
  expect(operation).toThrow(ApiContractError);
}

describe('workspace contract', () => {
  it('normalizes a valid workspace and write request', () => {
    const graph = graphFixture();
    const state = validateWorkspaceState(graph, workspaceState());
    expect(state).toEqual(workspaceState());

    const request = parseWorkspaceWriteRequest({
      expectedUpdatedAt: graph.updatedAt,
      graph,
      state,
    });
    expect(toWorkspaceSnapshot(request)).toEqual({ graph, state });
    expect(request.graph).not.toBe(graph);
    expect(parseWorkspaceSnapshot({ graph, state })).toEqual({ graph, state });
  });

  it('persists attachment blocks without treating them as portable exports', () => {
    const graph = createNode(graphFixture(), {
      blocks: [
        {
          attachmentId: 'attachment-local',
          id: 'block-attachment',
          mediaType: 'application/pdf',
          name: 'notes.pdf',
          type: 'attachment',
        },
      ],
      createdAt: NOW,
      kind: 'attachment',
      nodeId: 'node-attachment',
      revisionId: 'revision-attachment',
    });
    const state = workspaceState();
    expect(parseWorkspaceSnapshot({ graph, state })).toEqual({ graph, state });
  });

  it.each([
    null,
    {},
    { ...workspaceState(), version: 2 },
    { ...workspaceState(), extra: true },
    {
      ...workspaceState(),
      contextSelections: { missing: { mode: 'full' } },
    },
    {
      ...workspaceState(),
      contextSelections: { 'node-user': { mode: 'unknown' } },
    },
    {
      ...workspaceState(),
      contextSelections: {
        'node-user': { blockIds: [], mode: 'blocks' },
      },
    },
    {
      ...workspaceState(),
      contextSelections: {
        'node-user': {
          blockIds: ['block-user', 'block-user'],
          mode: 'blocks',
        },
      },
    },
    {
      ...workspaceState(),
      contextSelections: {
        'node-user': { blockIds: ['missing'], mode: 'blocks' },
      },
    },
    {
      ...workspaceState(),
      view: { groups: [], positions: { missing: { x: 1, y: 2 } } },
    },
  ])('rejects invalid workspace state %#', (state) => {
    expect(() => validateWorkspaceState(graphFixture(), state)).toThrow();
  });

  it.each([
    null,
    {},
    {
      expectedUpdatedAt: 2,
      graph: graphFixture(),
      state: workspaceState(),
    },
    {
      expectedUpdatedAt: null,
      graph: {},
      state: workspaceState(),
    },
    {
      expectedUpdatedAt: null,
      extra: true,
      graph: graphFixture(),
      state: workspaceState(),
    },
  ])('rejects invalid workspace writes %#', (value) => {
    expectContractError(() => parseWorkspaceWriteRequest(value));
  });
});

describe('local provider profile contract', () => {
  it('normalizes hosted and OpenAI-compatible profiles', () => {
    expect(
      parseCreateProviderProfileRequest({
        apiKey: 'secret',
        baseUrl: null,
        label: 'Personal OpenAI',
        models: [],
        providerType: 'openai',
      }),
    ).toEqual({
      apiKey: 'secret',
      baseUrl: null,
      label: 'Personal OpenAI',
      models: [],
      providerType: 'openai',
    });
    expect(
      parseCreateProviderProfileRequest({
        apiKey: null,
        baseUrl: 'http://127.0.0.1:11434/v1',
        label: 'Local',
        models: ['qwen3', 'llama3'],
        providerType: 'openai-compatible',
      }),
    ).toMatchObject({ apiKey: null, models: ['qwen3', 'llama3'] });
  });

  const valid = {
    apiKey: 'secret',
    baseUrl: null,
    label: 'Profile',
    models: [] as readonly string[],
    providerType: 'deepseek',
  };

  it.each([
    null,
    {},
    { ...valid, extra: true },
    { ...valid, providerType: 'unknown' },
    { ...valid, apiKey: ' ' },
    { ...valid, models: 'model' },
    { ...valid, models: [''] },
    { ...valid, models: ['same', 'same'] },
    { ...valid, apiKey: null },
    {
      ...valid,
      apiKey: null,
      baseUrl: null,
      providerType: 'openai-compatible',
    },
    {
      ...valid,
      apiKey: null,
      baseUrl: null,
      models: ['m'],
      providerType: 'openai-compatible',
    },
    { ...valid, baseUrl: 'not a URL' },
    { ...valid, baseUrl: 'file:///tmp/provider' },
    { ...valid, baseUrl: 'https://user:pass@example.com/v1' },
    { ...valid, baseUrl: 'https://example.com/v1?key=value' },
    { ...valid, baseUrl: 'https://example.com/v1#fragment' },
  ])('rejects an invalid provider profile %#', (value) => {
    expectContractError(() => parseCreateProviderProfileRequest(value));
  });
});

describe('Python execution contract', () => {
  it('normalizes an ordered list of code cells', () => {
    expect(
      parsePythonExecutionRequest({
        cells: [
          { nodeId: 'node-cell-1', source: 'value = 2' },
          { nodeId: 'node-cell-2', source: 'print(value)' },
        ],
        graphId: 'graph-study',
      }),
    ).toEqual({
      cells: [
        { nodeId: 'node-cell-1', source: 'value = 2' },
        { nodeId: 'node-cell-2', source: 'print(value)' },
      ],
      graphId: 'graph-study',
    });
  });

  it.each([
    null,
    {},
    { cells: [], graphId: 'graph-study' },
    {
      cells: Array.from({ length: 65 }, (_, index) => ({
        nodeId: `node-${String(index)}`,
        source: '',
      })),
      graphId: 'graph-study',
    },
    { cells: [{ nodeId: 'bad id', source: 'x' }], graphId: 'graph-study' },
    { cells: [{ nodeId: 'node-1', source: 2 }], graphId: 'graph-study' },
    {
      cells: [{ nodeId: 'node-1', source: 'x'.repeat(100_001) }],
      graphId: 'graph-study',
    },
    {
      cells: Array.from({ length: 6 }, (_, index) => ({
        nodeId: `node-${String(index)}`,
        source: 'x'.repeat(100_000),
      })),
      graphId: 'graph-study',
    },
    {
      cells: [{ extra: true, nodeId: 'node-1', source: 'x' }],
      graphId: 'graph-study',
    },
    { cells: [{ nodeId: 'node-1', source: 'x' }], graphId: 'bad id' },
  ])('rejects invalid Python input %#', (value) => {
    expectContractError(() => parsePythonExecutionRequest(value));
  });
});

describe('generation request contract', () => {
  it('normalizes a complete generation request', () => {
    expect(
      parseGenerationApiRequest(generationRequest(), graphFixture()),
    ).toEqual(generationRequest());
  });

  it('accepts pinned revisions, nullable titles, and minimal settings', () => {
    const request = generationRequest();
    expect(
      parseGenerationApiRequest(
        {
          ...request,
          context: {
            heads: [
              {
                label: 'Pinned',
                nodeId: 'node-user',
                revisionId: 'revision-user',
                slot: 0,
              },
            ],
            overrides: [
              {
                nodeId: 'node-user',
                revisionId: 'revision-user',
                selection: { mode: 'full' },
              },
            ],
          },
          request: { model: 'local' },
          title: null,
        },
        graphFixture(),
      ),
    ).toMatchObject({ request: { model: 'local' }, title: null });
  });

  it.each([
    null,
    { ...generationRequest(), graphId: 'other' },
    { ...generationRequest(), providerId: 'bad id' },
    { ...generationRequest(), title: '' },
    { ...generationRequest(), extra: true },
    {
      ...generationRequest(),
      context: { heads: [], overrides: [] },
    },
    {
      ...generationRequest(),
      context: {
        heads: [{ label: 'Head', nodeId: 'missing', slot: 0 }],
        overrides: [],
      },
    },
    {
      ...generationRequest(),
      context: {
        heads: [
          {
            label: 'Head',
            nodeId: 'node-user',
            revisionId: 'revision-system',
            slot: 0,
          },
        ],
        overrides: [],
      },
    },
    {
      ...generationRequest(),
      context: {
        heads: [
          { label: 'One', nodeId: 'node-user', slot: 0 },
          { label: 'Two', nodeId: 'node-system', slot: 0 },
        ],
        overrides: [],
      },
    },
    {
      ...generationRequest(),
      context: {
        heads: [{ label: '', nodeId: 'node-user', slot: -1 }],
        overrides: [],
      },
    },
    {
      ...generationRequest(),
      context: {
        heads: [{ label: 'Head', nodeId: 'node-user', slot: 0 }],
        overrides: 'bad',
      },
    },
    {
      ...generationRequest(),
      context: {
        heads: [{ label: 'Head', nodeId: 'node-user', slot: 0 }],
        overrides: [{ nodeId: 'missing', selection: { mode: 'full' } }],
      },
    },
    {
      ...generationRequest(),
      context: {
        heads: [{ label: 'Head', nodeId: 'node-user', slot: 0 }],
        overrides: [
          {
            nodeId: 'node-user',
            revisionId: 'revision-system',
            selection: { mode: 'full' },
          },
        ],
      },
    },
    {
      ...generationRequest(),
      context: {
        heads: [{ label: 'Head', nodeId: 'node-user', slot: 0 }],
        overrides: [],
        tokenBudget: 0,
      },
    },
    { ...generationRequest(), request: { model: '', temperature: 0.2 } },
    { ...generationRequest(), request: { model: 'm', maxOutputTokens: 0 } },
    { ...generationRequest(), request: { model: 'm', temperature: 3 } },
    { ...generationRequest(), request: { model: 'm', topP: -1 } },
    { ...generationRequest(), request: { model: 'm', stop: [] } },
    { ...generationRequest(), request: { model: 'm', unknown: true } },
  ])('rejects an invalid generation request %#', (value) => {
    expectContractError(() => parseGenerationApiRequest(value, graphFixture()));
  });
});

describe('generation stream contract', () => {
  const events = [
    {
      createdAt: NOW,
      model: 'resolved-model',
      responseId: 'response-1',
      type: 'response-start',
    },
    { delta: 'think', type: 'reasoning-delta' },
    { delta: 'answer', type: 'text-delta' },
    { inputTokens: 4, outputTokens: 2, totalTokens: 6, type: 'usage' },
    { finishReason: 'stop', rawFinishReason: 'stop', type: 'response-end' },
  ] as const;

  it('round-trips every provider event through newline-delimited JSON', () => {
    for (const event of events) {
      const item = { event, type: 'provider-event' } as const;
      const line = serializeNdjson(item);
      expect(line.endsWith('\n')).toBe(true);
      expect(parseGenerationStreamLine(line)).toEqual(item);
    }
  });

  it('parses terminal completion and sanitized error items', () => {
    const graph = graphFixture();
    const complete: GenerationStreamItem = {
      type: 'generation-complete',
      workspace: { graph, state: workspaceState() },
    };
    const error: GenerationStreamItem = {
      error: { code: 'PROVIDER_ERROR', message: 'Provider unavailable' },
      type: 'generation-error',
    };
    expect(parseGenerationStreamLine(serializeNdjson(complete))).toEqual(
      complete,
    );
    expect(parseGenerationStreamLine(serializeNdjson(error))).toEqual(error);
  });

  it.each([
    'not-json',
    '{}',
    JSON.stringify({ event: { type: 'unknown' }, type: 'provider-event' }),
    JSON.stringify({
      event: { delta: 2, type: 'text-delta' },
      type: 'provider-event',
    }),
    JSON.stringify({
      event: {
        createdAt: 2,
        model: 'm',
        responseId: 'r',
        type: 'response-start',
      },
      type: 'provider-event',
    }),
    JSON.stringify({
      event: {
        inputTokens: -1,
        outputTokens: 0,
        totalTokens: 0,
        type: 'usage',
      },
      type: 'provider-event',
    }),
    JSON.stringify({
      event: {
        finishReason: 'bad',
        rawFinishReason: null,
        type: 'response-end',
      },
      type: 'provider-event',
    }),
    JSON.stringify({
      error: { code: '', message: 'x' },
      type: 'generation-error',
    }),
    JSON.stringify({ type: 'generation-complete', workspace: {} }),
  ])('rejects an invalid stream line %#', (line) => {
    expectContractError(() => parseGenerationStreamLine(line));
  });
});
