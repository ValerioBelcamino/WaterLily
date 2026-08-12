import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({
  listener: undefined as
    ((request: IncomingMessage, response: ServerResponse) => void) | undefined,
}));

vi.mock('node:http', () => ({
  createServer: vi.fn(
    (
      listener: (request: IncomingMessage, response: ServerResponse) => void,
    ) => {
      capture.listener = listener;
      return { kind: 'mock-server' };
    },
  ),
}));

import { createNodeServer } from '../src/nodeServer.js';

function incoming(body: string, method = 'POST'): IncomingMessage {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      if (body.length > 0) yield Buffer.from(body);
    },
    headers: { host: '127.0.0.1', 'x-test': ['one', 'two'] },
    method,
    url: '/test',
  } as unknown as IncomingMessage;
}

function unusualIncoming(
  chunks: readonly unknown[],
  fields: {
    readonly headers?: IncomingMessage['headers'];
    readonly method?: string;
    readonly url?: string;
  } = {},
): IncomingMessage {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      yield* chunks;
    },
    headers: fields.headers ?? {},
    ...(fields.method === undefined ? {} : { method: fields.method }),
    ...(fields.url === undefined ? {} : { url: fields.url }),
  } as unknown as IncomingMessage;
}

function outgoing(throwOnWrite = false) {
  const target = {
    destroy: vi.fn(),
    end: vi.fn((chunk?: string) => {
      void chunk;
    }),
    headersSent: false,
    write: vi.fn((chunk: Uint8Array) => {
      void chunk;
      if (throwOnWrite) throw new Error('socket failed');
      return true;
    }),
    writeHead: vi.fn(function (
      this: { headersSent: boolean },
      status: number,
      headers: Readonly<Record<string, string>>,
    ) {
      void status;
      void headers;
      this.headersSent = true;
      return this;
    }),
  };
  return target;
}

describe('Node HTTP adapter', () => {
  beforeEach(() => {
    capture.listener = undefined;
  });

  it('adapts Node requests and streams Fetch responses', async () => {
    const handler = vi.fn(async (request: Request) => {
      expect(request.method).toBe('POST');
      expect(request.headers.get('x-test')).toBe('one, two');
      expect(await request.text()).toBe('hello');
      return new Response('world', {
        status: 202,
        headers: { 'x-result': 'ok' },
      });
    });
    expect(createNodeServer(handler)).toEqual({ kind: 'mock-server' });
    const target = outgoing();
    capture.listener?.(incoming('hello'), target as unknown as ServerResponse);
    await vi.waitFor(() => expect(target.end).toHaveBeenCalledOnce());
    expect(target.writeHead).toHaveBeenCalledWith(
      202,
      expect.objectContaining({ 'x-result': 'ok' }),
    );
    expect(
      Buffer.concat(target.write.mock.calls.map(([chunk]) => chunk)).toString(),
    ).toBe('world');
    expect(target.end).toHaveBeenCalledOnce();
  });

  it('omits bodies for GET and enforces the adapter byte limit', async () => {
    const handler = vi.fn((request: Request) => {
      expect(request.body).toBeNull();
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    createNodeServer(handler, 3);
    const getTarget = outgoing();
    capture.listener?.(
      incoming('', 'GET'),
      getTarget as unknown as ServerResponse,
    );
    await vi.waitFor(() => expect(getTarget.end).toHaveBeenCalledOnce());

    const target = outgoing();
    capture.listener?.(incoming('large'), target as unknown as ServerResponse);
    await vi.waitFor(() => expect(target.end).toHaveBeenCalledOnce());
    expect(target.writeHead).toHaveBeenCalledWith(
      413,
      expect.objectContaining({
        'content-type': 'application/json; charset=utf-8',
      }),
    );
    expect(target.end.mock.calls[0]?.[0]).toContain('HTTP_413');
  });

  it('sanitizes handler failures and destroys partially written responses', async () => {
    createNodeServer(() => Promise.reject(new Error('secret')));
    const target = outgoing();
    capture.listener?.(incoming(''), target as unknown as ServerResponse);
    await vi.waitFor(() => expect(target.end).toHaveBeenCalledOnce());
    expect(target.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    expect(target.end.mock.calls[0]?.[0]).not.toContain('secret');

    createNodeServer(() => Promise.resolve(new Response('body')));
    const partial = outgoing(true);
    capture.listener?.(incoming(''), partial as unknown as ServerResponse);
    await vi.waitFor(() => expect(partial.destroy).toHaveBeenCalledOnce());
  });

  it('normalizes string chunks and absent optional Node request fields', async () => {
    const handler = vi.fn(async (request: Request) => {
      await request.arrayBuffer();
      return new Response(null, { status: 204 });
    });
    createNodeServer(handler);
    const stringTarget = outgoing();
    capture.listener?.(
      unusualIncoming(['hello'], {
        headers: { host: '127.0.0.1', ignored: undefined },
        method: 'POST',
        url: '/string',
      }),
      stringTarget as unknown as ServerResponse,
    );
    await vi.waitFor(() => expect(stringTarget.end).toHaveBeenCalledOnce());

    const defaultsTarget = outgoing();
    capture.listener?.(
      unusualIncoming([], { headers: { ignored: undefined }, method: 'HEAD' }),
      defaultsTarget as unknown as ServerResponse,
    );
    await vi.waitFor(() => expect(defaultsTarget.end).toHaveBeenCalledOnce());
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported incoming chunks without exposing their values', async () => {
    createNodeServer(() => Promise.resolve(new Response('unused')));
    const target = outgoing();
    capture.listener?.(
      unusualIncoming([42], { method: 'POST', url: '/bad' }),
      target as unknown as ServerResponse,
    );
    await vi.waitFor(() => expect(target.end).toHaveBeenCalledOnce());
    expect(target.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    expect(target.end.mock.calls[0]?.[0]).not.toContain('42');
  });
});
