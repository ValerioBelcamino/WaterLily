import {
  compileContext,
  type CompiledContext,
  type CompiledContextItem,
} from '@waterlily/context-engine';
import {
  connectContext,
  createNode,
  type GraphSnapshot,
  type JsonValue,
} from '@waterlily/domain';
import type {
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  UsageEvent,
} from '@waterlily/providers';

import { failWorkflow } from './errors.js';
import type {
  GeneratedResponseCommit,
  GenerationResult,
  RunGenerationInput,
  SerializedProviderRequest,
} from './types.js';

function itemText(item: CompiledContextItem): string {
  const content = item.blocks
    .map((block) => {
      if (block.type === 'attachment') {
        failWorkflow(
          'UNSUPPORTED_CONTENT',
          'The initial chat serializer cannot send attachment blocks',
          { blockId: block.id, nodeId: item.nodeId },
        );
      }
      return block.text;
    })
    .join('\n\n');
  if (item.role !== null) return content;
  const title = item.title === null ? '' : `: ${item.title}`;
  return `[${item.nodeKind}${title}]\n${content}`;
}

function itemMessage(item: CompiledContextItem): ChatMessage {
  const content = itemText(item);
  if (item.role === 'tool') {
    const toolCallId = item.metadata.toolCallId;
    if (typeof toolCallId !== 'string' || toolCallId.trim().length === 0) {
      failWorkflow(
        'UNSUPPORTED_CONTENT',
        'Tool context requires a toolCallId in revision metadata',
        { nodeId: item.nodeId, revisionId: item.revisionId },
      );
    }
    return { content, role: 'tool', toolCallId };
  }
  return { content, role: item.role ?? 'user' };
}

export function serializeCompiledContext(
  compiled: CompiledContext,
  request: Omit<ChatRequest, 'messages'>,
): SerializedProviderRequest {
  const messages: ChatMessage[] = compiled.common.items.map(itemMessage);
  if (compiled.branches.length > 0) {
    messages.push({
      content:
        'The following messages are grouped into explicitly selected context branches.',
      role: 'system',
    });
    for (const branch of compiled.branches) {
      messages.push({
        content: `Context branch ${String(branch.slot)}: ${JSON.stringify(branch.label)}`,
        role: 'system',
      });
      messages.push(...branch.items.map(itemMessage));
    }
  }
  return {
    contextHash: compiled.hash,
    request: { ...request, messages },
  };
}

function metadata(
  commit: GeneratedResponseCommit,
): Readonly<Record<string, JsonValue>> {
  const usage =
    commit.generation.usage === null
      ? null
      : {
          inputTokens: commit.generation.usage.inputTokens,
          outputTokens: commit.generation.usage.outputTokens,
          totalTokens: commit.generation.usage.totalTokens,
        };
  return {
    generation: {
      contextHash: commit.generation.contextHash,
      finishReason: commit.generation.finishReason,
      model: commit.generation.model,
      providerId: commit.generation.providerId,
      publicReasoning: commit.reasoning,
      request: commit.generation.serializedRequest as unknown as JsonValue,
      responseId: commit.generation.responseId,
      usage,
    },
  };
}

export function applyGenerationCommit(
  graph: GraphSnapshot,
  commit: GeneratedResponseCommit,
): GraphSnapshot {
  if (commit.contextEdges.length === 0) {
    failWorkflow(
      'INVALID_OPERATION',
      'A generated response requires context heads',
    );
  }
  let next = createNode(graph, {
    blocks: [
      {
        format: 'markdown',
        id: commit.output.blockId,
        text: commit.content,
        type: 'text',
      },
    ],
    createdAt: commit.output.createdAt,
    kind: 'message',
    metadata: metadata(commit),
    nodeId: commit.output.nodeId,
    revisionId: commit.output.revisionId,
    role: 'assistant',
    title: commit.output.title ?? null,
  });
  for (const edge of commit.contextEdges) {
    next = connectContext(next, {
      createdAt: commit.output.createdAt,
      edgeId: edge.edgeId,
      label: edge.label,
      slot: edge.slot,
      sourceNodeId: edge.sourceNodeId,
      sourceRevisionId: edge.sourceRevisionId,
      targetNodeId: commit.output.nodeId,
    });
  }
  return next;
}

function validateEventSequence(
  event: ChatStreamEvent,
  state: { ended: boolean; started: boolean },
): void {
  if (state.ended) {
    failWorkflow(
      'INCOMPLETE_RESPONSE',
      'Provider emitted data after its terminal event',
    );
  }
  if (event.type === 'response-start') {
    if (state.started) {
      failWorkflow(
        'INCOMPLETE_RESPONSE',
        'Provider emitted duplicate response metadata',
      );
    }
    state.started = true;
    return;
  }
  if (!state.started) {
    failWorkflow(
      'INCOMPLETE_RESPONSE',
      'Provider emitted data before response metadata',
    );
  }
  if (event.type === 'response-end') state.ended = true;
}

export async function runGeneration(
  input: RunGenerationInput,
): Promise<GenerationResult> {
  if (input.output.contextEdgeIds.length !== input.context.heads.length) {
    failWorkflow(
      'INVALID_OPERATION',
      'Generation requires one output edge id for every context head',
    );
  }
  const compiledContext = await compileContext({
    ...input.context,
    graph: input.graph,
  });
  const serializedRequest = serializeCompiledContext(
    compiledContext,
    input.request,
  );
  const state = { ended: false, started: false };
  let content = '';
  let reasoning = '';
  let responseId = '';
  let model = input.request.model;
  let finishReason:
    GeneratedResponseCommit['generation']['finishReason'] | null = null;
  let usage: Omit<UsageEvent, 'type'> | null = null;

  for await (const event of input.provider.streamChat(
    serializedRequest.request,
    {
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  )) {
    validateEventSequence(event, state);
    switch (event.type) {
      case 'response-start':
        responseId = event.responseId;
        model = event.model;
        break;
      case 'reasoning-delta':
        reasoning += event.delta;
        break;
      case 'text-delta':
        content += event.delta;
        break;
      case 'usage':
        usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
        };
        break;
      case 'response-end':
        finishReason = event.finishReason;
        break;
    }
    await input.onEvent?.(event);
  }

  if (!state.started || !state.ended || finishReason === null) {
    failWorkflow(
      'INCOMPLETE_RESPONSE',
      'Provider stream ended without a terminal event',
    );
  }
  if (content.length === 0) {
    failWorkflow('EMPTY_RESPONSE', 'Provider completed without answer text');
  }

  const contextEdges = input.context.heads.map((head, slot) => {
    const node = input.graph.nodes[head.nodeId] as {
      readonly currentRevisionId: string;
    };
    const edgeId = input.output.contextEdgeIds[slot] as string;
    return {
      edgeId,
      label: head.label,
      slot: head.slot,
      sourceNodeId: head.nodeId,
      sourceRevisionId: head.revisionId ?? node.currentRevisionId,
    };
  });
  const commit: GeneratedResponseCommit = {
    content,
    contextEdges,
    generation: {
      contextHash: compiledContext.hash,
      finishReason,
      model,
      providerId: input.provider.id,
      responseId,
      serializedRequest,
      usage,
    },
    output: input.output,
    reasoning,
  };
  return {
    commit,
    compiledContext,
    graph: applyGenerationCommit(input.graph, commit),
    serializedRequest,
  };
}
