import { compileContext } from '@llm-graph/context-engine';
import {
  connectContext,
  createNode,
  reviseNode,
  type GraphSnapshot,
} from '@llm-graph/domain';
import type { ChatProvider, ChatStreamEvent } from '@llm-graph/providers';
import { describe, expect, it, vi } from 'vitest';

import {
  applyGenerationCommit,
  runGeneration,
  serializeCompiledContext,
  WorkflowError,
  type GeneratedResponseCommit,
} from '../src/index.js';
import { completeEvents, linearGraph, providerWith, time } from './helpers.js';

const context = {
  heads: [{ label: 'Main', nodeId: 'node-user', slot: 0 }],
} as const;

const output = {
  blockId: 'block-assistant',
  contextEdgeIds: ['edge-user-assistant'],
  createdAt: time(20),
  nodeId: 'node-assistant',
  revisionId: 'revision-assistant',
  title: 'Generated answer',
} as const;

async function generate(
  provider: ChatProvider = providerWith(completeEvents),
  overrides: Partial<Parameters<typeof runGeneration>[0]> = {},
) {
  return runGeneration({
    context,
    graph: linearGraph(),
    output,
    provider,
    request: { model: 'fixture-model', temperature: 0 },
    ...overrides,
  });
}

function isEvent(event: ChatStreamEvent | undefined): event is ChatStreamEvent {
  return event !== undefined;
}

describe('generation workflows', () => {
  it('compiles, serializes, streams, and atomically commits a response', async () => {
    const observed: ChatStreamEvent[] = [];
    const result = await generate(undefined, {
      onEvent: (event) => {
        observed.push(event);
      },
    });

    expect(observed).toEqual(completeEvents);
    expect(result.serializedRequest).toMatchObject({
      contextHash: result.compiledContext.hash,
      request: {
        messages: [
          { content: 'Be precise.', role: 'system' },
          { content: 'Explain ATP.', role: 'user' },
        ],
        model: 'fixture-model',
        temperature: 0,
      },
    });
    expect(result.commit).toMatchObject({
      content: 'ATP answer',
      generation: {
        finishReason: 'stop',
        model: 'fixture-model-resolved',
        providerId: 'fixture-provider',
        responseId: 'response-1',
        serializedRequest: result.serializedRequest,
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      },
      reasoning: 'public thought',
    });
    expect(result.graph.nodes['node-assistant']).toMatchObject({
      kind: 'message',
      role: 'assistant',
      title: 'Generated answer',
    });
    expect(result.graph.edges['edge-user-assistant']).toMatchObject({
      sourceRevisionId: 'revision-user',
      targetNodeId: 'node-assistant',
    });
    expect(
      result.graph.revisions['revision-assistant']?.metadata,
    ).toMatchObject({
      generation: {
        contextHash: result.compiledContext.hash,
        providerId: 'fixture-provider',
        publicReasoning: 'public thought',
        request: result.serializedRequest,
        usage: { totalTokens: 7 },
      },
    });
  });

  it('passes cancellation to the provider and awaits async observers', async () => {
    const controller = new AbortController();
    const inspect = vi.fn();
    const order: string[] = [];
    const provider = providerWith(completeEvents, inspect);

    await generate(provider, {
      onEvent: async (event) => {
        await Promise.resolve();
        order.push(event.type);
      },
      signal: controller.signal,
    });

    expect(inspect).toHaveBeenCalledWith({ signal: controller.signal });
    expect(order).toEqual(completeEvents.map((event) => event.type));
  });

  it('commits null usage and an untitled output from an explicitly pinned head', async () => {
    const events = completeEvents.filter((event) => event.type !== 'usage');
    const result = await generate(providerWith(events), {
      context: {
        heads: [
          {
            label: 'Pinned',
            nodeId: 'node-user',
            revisionId: 'revision-user',
            slot: 0,
          },
        ],
      },
      output: {
        blockId: output.blockId,
        contextEdgeIds: output.contextEdgeIds,
        createdAt: output.createdAt,
        nodeId: output.nodeId,
        revisionId: output.revisionId,
      },
    });

    expect(result.graph.nodes['node-assistant']?.title).toBeNull();
    expect(
      result.graph.revisions['revision-assistant']?.metadata,
    ).toMatchObject({
      generation: { usage: null },
    });
    expect(result.commit.contextEdges[0]).toMatchObject({
      sourceRevisionId: 'revision-user',
    });
  });

  it('applies concurrent generation commits to one latest graph', async () => {
    const first = await generate();
    const second = await generate(providerWith(completeEvents), {
      output: {
        ...output,
        blockId: 'block-assistant-2',
        contextEdgeIds: ['edge-user-assistant-2'],
        nodeId: 'node-assistant-2',
        revisionId: 'revision-assistant-2',
      },
    });

    let latest = applyGenerationCommit(linearGraph(), first.commit);
    latest = applyGenerationCommit(latest, second.commit);
    expect(latest.nodes['node-assistant']).toBeDefined();
    expect(latest.nodes['node-assistant-2']).toBeDefined();
    expect(
      Object.values(latest.edges).filter(
        (edge) => edge.sourceNodeId === 'node-user',
      ),
    ).toHaveLength(2);
  });

  it('keeps the compiled head revision pinned when committed onto a revised graph', async () => {
    const result = await generate();
    const revised = reviseNode(linearGraph(), {
      blocks: [
        { format: 'plain', id: 'block-new', text: 'New prompt', type: 'text' },
      ],
      createdAt: time(21),
      nodeId: 'node-user',
      revisionId: 'revision-user-new',
    });
    const committed = applyGenerationCommit(revised, result.commit);

    expect(committed.nodes['node-user']?.currentRevisionId).toBe(
      'revision-user-new',
    );
    expect(committed.edges['edge-user-assistant']).toMatchObject({
      sourceRevisionId: 'revision-user',
    });
  });

  it('serializes labelled merge branches and non-message nodes visibly', async () => {
    let graph = linearGraph();
    graph = createNode(graph, {
      blocks: [
        {
          format: 'plain',
          id: 'block-note',
          text: 'Dam analogy',
          type: 'text',
        },
      ],
      createdAt: time(4),
      kind: 'note',
      nodeId: 'node-note',
      revisionId: 'revision-note',
      title: 'Analogy',
    });
    const compiled = await compileContext({
      graph,
      heads: [
        { label: 'Question', nodeId: 'node-user', slot: 0 },
        { label: 'Side note', nodeId: 'node-note', slot: 1 },
      ],
    });
    const serialized = serializeCompiledContext(compiled, { model: 'm' });

    expect(serialized.request.messages).toEqual([
      {
        content:
          'The following messages are grouped into explicitly selected context branches.',
        role: 'system',
      },
      { content: 'Context branch 0: "Question"', role: 'system' },
      { content: 'Be precise.', role: 'system' },
      { content: 'Explain ATP.', role: 'user' },
      { content: 'Context branch 1: "Side note"', role: 'system' },
      { content: '[note: Analogy]\nDam analogy', role: 'user' },
    ]);
  });

  it('labels an untitled non-message node without inventing a title', async () => {
    const graph = createNode(linearGraph(), {
      blocks: [
        {
          format: 'plain',
          id: 'block-note',
          text: 'Remember this',
          type: 'text',
        },
      ],
      createdAt: time(4),
      kind: 'note',
      nodeId: 'node-note',
      revisionId: 'revision-note',
    });
    const compiled = await compileContext({
      graph,
      heads: [{ label: 'Note', nodeId: 'node-note', slot: 0 }],
    });

    expect(
      serializeCompiledContext(compiled, { model: 'm' }).request.messages,
    ).toEqual([{ content: '[note]\nRemember this', role: 'user' }]);
  });

  it('serializes tool messages only with explicit call provenance', async () => {
    let graph = linearGraph();
    graph = createNode(graph, {
      blocks: [
        {
          format: 'plain',
          id: 'block-tool',
          text: '{"value":4}',
          type: 'text',
        },
      ],
      createdAt: time(4),
      kind: 'message',
      metadata: { toolCallId: 'call-7' },
      nodeId: 'node-tool',
      revisionId: 'revision-tool',
      role: 'tool',
    });
    graph = connectContext(graph, {
      createdAt: time(5),
      edgeId: 'edge-user-tool',
      slot: 0,
      sourceNodeId: 'node-user',
      targetNodeId: 'node-tool',
    });
    const compiled = await compileContext({
      graph,
      heads: [{ label: 'Tool', nodeId: 'node-tool', slot: 0 }],
    });

    expect(
      serializeCompiledContext(compiled, { model: 'm' }).request.messages.at(
        -1,
      ),
    ).toEqual({ content: '{"value":4}', role: 'tool', toolCallId: 'call-7' });
  });

  it.each([
    {
      name: 'data before start',
      events: [{ delta: 'x', type: 'text-delta' }],
      message: 'before response metadata',
    },
    {
      name: 'duplicate start',
      events: [completeEvents[0], completeEvents[0]],
      message: 'duplicate response metadata',
    },
    {
      name: 'data after end',
      events: [...completeEvents, { delta: 'late', type: 'text-delta' }],
      message: 'after its terminal event',
    },
    {
      name: 'missing end',
      events: completeEvents.slice(0, -1),
      message: 'without a terminal event',
    },
    {
      name: 'empty response',
      events: [completeEvents[0], completeEvents.at(-1)],
      message: 'without answer text',
    },
  ] as const)('rejects $name', async ({ events, message }) => {
    const definedEvents: ChatStreamEvent[] = [];
    for (const event of events) {
      if (isEvent(event)) definedEvents.push(event);
    }
    await expect(generate(providerWith(definedEvents))).rejects.toThrow(
      message,
    );
  });

  it('rejects mismatched edge identities and context-free commits', async () => {
    await expect(
      generate(undefined, { output: { ...output, contextEdgeIds: [] } }),
    ).rejects.toThrow('one output edge id');
    const commit = {
      ...(await generate()).commit,
      contextEdges: [],
    } satisfies GeneratedResponseCommit;
    expect(() => applyGenerationCommit(linearGraph(), commit)).toThrow(
      WorkflowError,
    );
  });

  it('rejects attachment blocks and tool messages without call ids', async () => {
    const withNode = (
      graph: GraphSnapshot,
      role: 'tool' | null,
      attachment: boolean,
    ): GraphSnapshot =>
      createNode(graph, {
        blocks: attachment
          ? [
              {
                attachmentId: 'asset-1',
                id: 'block-special',
                mediaType: 'image/png',
                name: null,
                type: 'attachment',
              },
            ]
          : [
              {
                format: 'plain',
                id: 'block-special',
                text: '{}',
                type: 'text',
              },
            ],
        createdAt: time(4),
        kind: attachment ? 'attachment' : 'message',
        nodeId: 'node-special',
        revisionId: 'revision-special',
        role,
      });

    for (const graph of [
      withNode(linearGraph(), null, true),
      withNode(linearGraph(), 'tool', false),
    ]) {
      const compiled = await compileContext({
        graph,
        heads: [{ label: 'Special', nodeId: 'node-special', slot: 0 }],
      });
      expect(() => serializeCompiledContext(compiled, { model: 'm' })).toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }),
      );
    }
  });
});
