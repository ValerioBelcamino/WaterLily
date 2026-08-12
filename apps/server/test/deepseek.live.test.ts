import {
  parseGenerationStreamLine,
  type GenerationStreamItem,
} from '@waterlily/api-contract';
import { describe, expect, it } from 'vitest';

import { configuredProviders } from '../src/config.js';
import { createWaterLilyHandler } from '../src/server.js';
import { generationRequest, MemoryStore, workspaceFixture } from './helpers.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
const runLive =
  process.env.RUN_LIVE_PROVIDER_TESTS === '1' && apiKey !== undefined;

describe.skipIf(!runLive)('DeepSeek live application service', () => {
  it(
    'compiles, streams, commits, and persists a real generation without leaking credentials',
    { timeout: 120_000 },
    async () => {
      const providers = configuredProviders(process.env);
      const deepSeek = providers.find(
        (provider) => provider.descriptor.id === 'deepseek',
      );
      expect(deepSeek?.descriptor).toMatchObject({
        available: true,
        defaultModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
      });

      const store = new MemoryStore();
      store.insert(workspaceFixture());
      let nextId = 0;
      const handler = createWaterLilyHandler({
        createId: (kind) => `live-${kind}-${String((nextId += 1))}`,
        now: () => '2026-08-05T13:00:00.000Z',
        providers,
        workspaces: store,
      });

      const health = await handler(
        new Request('http://127.0.0.1:4317/api/health'),
      );
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({
        providers: [
          {
            available: true,
            defaultModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
            id: 'deepseek',
            name: 'DeepSeek',
          },
          {
            available: false,
            defaultModel: 'local-model',
            id: 'local-openai-compatible',
            name: 'Local OpenAI-compatible model',
          },
        ],
        service: 'waterlily',
        version: '0.0.0',
      });

      const request = generationRequest('deepseek');
      const response = await handler(
        new Request('http://127.0.0.1:4317/api/generations', {
          body: JSON.stringify({
            ...request,
            request: {
              maxOutputTokens: 512,
              model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
            },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'application/x-ndjson',
      );

      const body = await response.text();
      const items = body
        .trim()
        .split('\n')
        .map((line) => parseGenerationStreamLine(line));
      expect(items.some((item) => item.type === 'generation-error')).toBe(
        false,
      );
      const providerEvents = items.flatMap((item) =>
        item.type === 'provider-event' ? [item.event] : [],
      );
      expect(
        providerEvents.some((event) => event.type === 'response-start'),
      ).toBe(true);
      expect(
        providerEvents.some((event) => event.type === 'reasoning-delta'),
      ).toBe(true);
      expect(providerEvents.some((event) => event.type === 'text-delta')).toBe(
        true,
      );
      expect(providerEvents.some((event) => event.type === 'usage')).toBe(true);
      expect(
        providerEvents.some((event) => event.type === 'response-end'),
      ).toBe(true);

      const completed = items.find(
        (
          item,
        ): item is Extract<
          GenerationStreamItem,
          { type: 'generation-complete' }
        > => item.type === 'generation-complete',
      );
      expect(completed).toBeDefined();
      if (completed === undefined) return;
      expect(Object.keys(completed.workspace.graph.nodes)).toHaveLength(3);
      expect(Object.keys(completed.workspace.graph.edges)).toHaveLength(2);
      const generatedNode = Object.values(completed.workspace.graph.nodes).find(
        (node) => node.id.startsWith('live-node-'),
      );
      expect(generatedNode).toMatchObject({
        kind: 'message',
        role: 'assistant',
      });
      const revision =
        generatedNode === undefined
          ? undefined
          : completed.workspace.graph.revisions[
              generatedNode.currentRevisionId
            ];
      const generatedText = revision?.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      expect(generatedText?.length).toBeGreaterThan(0);
      const generationMetadata = revision?.metadata.generation;
      expect(generationMetadata).toBeTypeOf('object');
      expect(generationMetadata).not.toBeNull();
      expect(Array.isArray(generationMetadata)).toBe(false);
      if (
        generationMetadata === null ||
        typeof generationMetadata !== 'object' ||
        Array.isArray(generationMetadata)
      ) {
        throw new TypeError('Generation metadata is unavailable');
      }
      const metadataRecord = generationMetadata as Readonly<
        Record<string, unknown>
      >;
      expect(metadataRecord.providerId).toBe('deepseek');
      expect(metadataRecord.model).toBeTypeOf('string');
      expect(String(metadataRecord.model)).toContain('deepseek');
      const usage = metadataRecord.usage;
      expect(usage).toBeTypeOf('object');
      expect(usage).not.toBeNull();
      if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
        throw new TypeError('Generation usage is unavailable');
      }
      expect(
        (usage as Readonly<Record<string, unknown>>).totalTokens,
      ).toBeTypeOf('number');
      expect(store.get('graph-server')).toEqual(completed.workspace);

      const serializedArtifacts = JSON.stringify({
        items,
        persisted: store.records,
      });
      expect(serializedArtifacts.includes(apiKey ?? '')).toBe(false);
    },
  );
});
