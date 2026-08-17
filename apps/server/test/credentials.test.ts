import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChatProvider } from '@waterlily/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CredentialProviderRegistry } from '../src/credentials.js';
import type { AttachmentStore } from '../src/types.js';

const temporaryDirectories: string[] = [];

function temporaryFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'waterlily-credentials-'));
  temporaryDirectories.push(directory);
  return join(directory, 'nested', 'credentials.json');
}

const getAttachment = vi.fn(() => ({
  bytes: new TextEncoder().encode('paper'),
  mediaType: 'application/pdf',
  name: 'paper.pdf',
}));

const attachments: AttachmentStore = {
  get: getAttachment,
  put: vi.fn(() => {
    throw new Error('not used');
  }),
};

function streamResponse(url: string): Response {
  if (url.endsWith('/responses')) {
    const values = [
      {
        response: { id: 'r', model: 'gpt', created_at: 1_786_000_000 },
        type: 'response.created',
      },
      { delta: 'ok', type: 'response.output_text.delta' },
      { response: {}, type: 'response.completed' },
    ];
    return new Response(
      `${values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join('')}data: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }
  const values = [
    {
      choices: [{ delta: { content: 'ok' }, finish_reason: null }],
      created: 1_786_000_000,
      id: 'r',
      model: 'model',
    },
    {
      choices: [{ delta: {}, finish_reason: 'stop' }],
      id: 'r',
      model: 'model',
    },
  ];
  return new Response(
    `${values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

async function consume(provider: ChatProvider, attachment = false) {
  const events = [];
  for await (const event of provider.streamChat({
    messages: [
      attachment
        ? {
            content: [
              {
                attachmentId: 'attachment-1',
                mediaType: 'application/pdf',
                name: 'paper.pdf',
                type: 'attachment' as const,
              },
            ],
            role: 'user' as const,
          }
        : { content: 'hello', role: 'user' as const },
    ],
    model: 'model',
  }))
    events.push(event);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
  getAttachment.mockClear();
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { force: true, recursive: true });
});

describe('credential provider registry', () => {
  it('persists, reloads, registers, and removes each profile type', async () => {
    const fetch = vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return Promise.resolve(streamResponse(url));
    });
    vi.stubGlobal('fetch', fetch);
    const path = temporaryFile();
    const registry = new CredentialProviderRegistry({
      attachments,
      now: () => '2026-08-17T10:00:00.000Z',
      path,
    });
    expect(registry.registrations()).toEqual([]);

    const openai = registry.create({
      apiKey: 'openai-secret',
      baseUrl: null,
      label: 'Personal OpenAI',
      models: [],
      providerType: 'openai',
    });
    const deepseek = registry.create({
      apiKey: 'deepseek-secret',
      baseUrl: null,
      label: 'DeepSeek study',
      models: [],
      providerType: 'deepseek',
    });
    const local = registry.create({
      apiKey: null,
      baseUrl: 'http://127.0.0.1:11434/v1',
      label: 'Local Qwen',
      models: ['qwen3'],
      providerType: 'openai-compatible',
    });

    expect(openai).toMatchObject({
      defaultModel: 'gpt-5.6-terra',
      source: 'stored',
    });
    expect(openai.models[0]).toMatchObject({
      capabilities: { nativeFiles: true },
      id: 'gpt-5.6-sol',
    });
    expect(deepseek.models.map((model) => model.id)).toEqual([
      'deepseek-chat',
      'deepseek-reasoner',
    ]);
    expect(local).toMatchObject({ defaultModel: 'qwen3' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, '..')).mode & 0o777).toBe(0o700);
    expect(readFileSync(path, 'utf8')).toContain('openai-secret');

    const registrations = registry.registrations();
    expect(registrations).toHaveLength(3);
    await consume(registrations[0]?.provider as ChatProvider, true);
    await consume(registrations[1]?.provider as ChatProvider);
    await consume(registrations[2]?.provider as ChatProvider);
    expect(getAttachment).toHaveBeenCalledWith('attachment-1');
    expect(fetch).toHaveBeenCalledTimes(3);

    const reloaded = new CredentialProviderRegistry({ attachments, path });
    expect(reloaded.registrations()).toHaveLength(3);
    expect(reloaded.remove('profile-missing')).toBe(false);
    expect(reloaded.remove(openai.id)).toBe(true);
    expect(
      reloaded.registrations().map(({ descriptor }) => descriptor.id),
    ).not.toContain(openai.id);
  });

  it('uses the system clock when no test clock is supplied', () => {
    const path = temporaryFile();
    const registry = new CredentialProviderRegistry({ attachments, path });
    registry.create({
      apiKey: 'secret',
      baseUrl: null,
      label: 'Default clock',
      models: ['deepseek-chat'],
      providerType: 'deepseek',
    });
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      profiles: readonly { readonly createdAt: string }[];
    };
    expect(stored.profiles[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it.each([
    { profiles: [], version: 2 },
    { profiles: 'bad', version: 1 },
    { profiles: [null], version: 1 },
    {
      profiles: [
        {
          apiKey: null,
          baseUrl: null,
          createdAt: 'time',
          id: 2,
          label: 'Bad',
          models: [],
          providerType: 'deepseek',
        },
      ],
      version: 1,
    },
    {
      profiles: [
        {
          apiKey: 2,
          baseUrl: false,
          createdAt: 3,
          id: 'id',
          label: 4,
          models: [2],
          providerType: 'unknown',
        },
      ],
      version: 1,
    },
  ])('rejects malformed credential files %#', (value) => {
    const path = temporaryFile();
    const nested = join(path, '..');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path, JSON.stringify(value));
    expect(() => new CredentialProviderRegistry({ attachments, path })).toThrow(
      /credential file|profile/iu,
    );
  });
});
