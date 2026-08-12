import { describe, expect, it } from 'vitest';

import { createDeepSeekProvider } from '../src/index.js';
import { collect } from './helpers.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
const runLive =
  process.env.RUN_LIVE_PROVIDER_TESTS === '1' && apiKey !== undefined;

describe.skipIf(!runLive)('DeepSeek live integration', () => {
  it('streams a minimal completion through the production endpoint', async () => {
    const provider = createDeepSeekProvider({ apiKey: apiKey ?? '' });
    const events = await collect(provider, {
      maxOutputTokens: 24,
      messages: [{ content: 'Reply with exactly: graph-ready', role: 'user' }],
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
      providerOptions: { thinking: { type: 'disabled' } },
      temperature: 0,
    });
    const text = events
      .filter((event) => event.type === 'text-delta')
      .map((event) => event.delta)
      .join('');

    expect(text.toLowerCase()).toContain('graph-ready');
    expect(events.some((event) => event.type === 'response-end')).toBe(true);
  });
});
