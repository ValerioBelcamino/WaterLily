import { describe, expect, it } from 'vitest';

import { createDeepSeekProvider, type ChatStreamEvent } from '../src/index.js';
import { collect } from './helpers.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
const runLive =
  process.env.RUN_LIVE_PROVIDER_TESTS === '1' && apiKey !== undefined;

describe.skipIf(!runLive)('DeepSeek live integration', () => {
  function assertCompleteLifecycle(events: readonly ChatStreamEvent[]): void {
    expect(
      events.filter((event) => event.type === 'response-start'),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === 'response-end'),
    ).toHaveLength(1);
    const usage = events.find((event) => event.type === 'usage');
    expect(usage).toBeDefined();
    if (usage?.type === 'usage') {
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
      expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
    }
    const serialized = JSON.stringify(events);
    expect(serialized.includes(apiKey ?? '')).toBe(false);
  }

  it(
    'streams a non-thinking completion through the production endpoint',
    { timeout: 120_000 },
    async () => {
      const provider = createDeepSeekProvider({ apiKey: apiKey ?? '' });
      expect(provider).toMatchObject({ id: 'deepseek', name: 'DeepSeek' });
      const events = await collect(provider, {
        maxOutputTokens: 24,
        messages: [
          { content: 'Reply with exactly: graph-ready', role: 'user' },
        ],
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        providerOptions: { thinking: { type: 'disabled' } },
        temperature: 0,
      });
      const text = events
        .filter((event) => event.type === 'text-delta')
        .map((event) => event.delta)
        .join('');

      expect(text.toLowerCase()).toContain('graph-ready');
      expect(events.some((event) => event.type === 'reasoning-delta')).toBe(
        false,
      );
      assertCompleteLifecycle(events);
    },
  );

  it(
    'streams public reasoning and answer text in thinking mode',
    { timeout: 120_000 },
    async () => {
      const provider = createDeepSeekProvider({ apiKey: apiKey ?? '' });
      const events = await collect(provider, {
        maxOutputTokens: 256,
        messages: [
          {
            content:
              'Which is larger, 9.8 or 9.11? Answer in one short sentence.',
            role: 'user',
          },
        ],
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        providerOptions: { thinking: { type: 'enabled' } },
      });
      const reasoningLength = events
        .filter((event) => event.type === 'reasoning-delta')
        .reduce((total, event) => total + event.delta.length, 0);
      const textLength = events
        .filter((event) => event.type === 'text-delta')
        .reduce((total, event) => total + event.delta.length, 0);

      expect(reasoningLength).toBeGreaterThan(0);
      expect(textLength).toBeGreaterThan(0);
      assertCompleteLifecycle(events);
    },
  );
});
