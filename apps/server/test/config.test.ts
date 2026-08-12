import { afterEach, describe, expect, it, vi } from 'vitest';

import { configuredProviders } from '../src/config.js';

describe('provider configuration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('advertises unavailable providers without exposing credentials', () => {
    const providers = configuredProviders({
      DEEPSEEK_API_KEY: '   ',
      DEEPSEEK_MODEL: '',
      LOCAL_LLM_BASE_URL: '',
      LOCAL_LLM_MODEL: ' ',
    });
    expect(providers.map(({ descriptor }) => descriptor)).toEqual([
      {
        available: false,
        defaultModel: 'deepseek-v4-flash',
        id: 'deepseek',
        name: 'DeepSeek',
      },
      {
        available: false,
        defaultModel: 'local-model',
        id: 'local-openai-compatible',
        name: 'Local OpenAI-compatible model',
      },
    ]);
    expect(JSON.stringify(providers)).not.toContain('apiKey');
  });

  it('constructs server-side DeepSeek and local providers from environment', () => {
    const providers = configuredProviders({
      DEEPSEEK_API_KEY: 'server-only-key',
      DEEPSEEK_BASE_URL: 'https://gateway.example/v1/',
      DEEPSEEK_MODEL: 'deepseek-custom',
      LOCAL_LLM_API_KEY: 'local-key',
      LOCAL_LLM_BASE_URL: 'http://127.0.0.1:11434/v1',
      LOCAL_LLM_MODEL: 'qwen-local',
    });
    expect(providers.map(({ descriptor }) => descriptor)).toMatchObject([
      { available: true, defaultModel: 'deepseek-custom' },
      { available: true, defaultModel: 'qwen-local' },
    ]);
    expect(providers.every(({ provider }) => provider !== undefined)).toBe(
      true,
    );
    expect(JSON.stringify(providers)).not.toContain('server-only-key');
    expect(JSON.stringify(providers)).not.toContain('local-key');
  });

  it('resolves credentials only inside the provider request boundary', async () => {
    const providerFetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        void input;
        void init;
        return Promise.resolve(new Response('rejected', { status: 500 }));
      },
    );
    vi.stubGlobal('fetch', providerFetch);
    const providers = configuredProviders({
      DEEPSEEK_API_KEY: 'deep-key',
      DEEPSEEK_BASE_URL: 'https://gateway.example/v1/',
      LOCAL_LLM_API_KEY: 'local-key',
      LOCAL_LLM_BASE_URL: 'http://127.0.0.1:11434/v1',
    });

    for (const registration of providers) {
      const stream = registration.provider?.streamChat({
        messages: [{ content: 'test', role: 'user' }],
        model: registration.descriptor.defaultModel,
      });
      const iterator = stream?.[Symbol.asyncIterator]();
      await expect(iterator?.next()).rejects.toThrow('Provider request failed');
    }
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(String(providerFetch.mock.calls[0]?.[0])).toBe(
      'https://gateway.example/v1/chat/completions',
    );
    expect(providerFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer deep-key',
    });
    expect(providerFetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer local-key',
    });
  });
});
