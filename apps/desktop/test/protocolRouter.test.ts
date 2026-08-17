import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopProtocolRouter } from '../src/protocolRouter.js';

const temporaryDirectories: string[] = [];

function fixture() {
  const staticDirectory = mkdtempSync(join(tmpdir(), 'waterlily-desktop-'));
  temporaryDirectories.push(staticDirectory);
  mkdirSync(join(staticDirectory, 'assets'));
  writeFileSync(join(staticDirectory, 'index.html'), '<h1>WaterLily</h1>');
  writeFileSync(join(staticDirectory, 'assets', 'app.js'), 'export {};');
  const apiHandler = vi.fn(() =>
    Promise.resolve(Response.json({ service: 'waterlily' })),
  );
  return {
    apiHandler,
    route: createDesktopProtocolRouter({ apiHandler, staticDirectory }),
  };
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { force: true, recursive: true });
});

describe('desktop protocol router', () => {
  it('serves the renderer with restrictive browser headers', async () => {
    const { route } = fixture();
    const response = await route(new Request('waterlily://app/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(response.headers.get('content-security-policy')).toContain(
      "script-src 'self'",
    );
    expect(await response.text()).toBe('<h1>WaterLily</h1>');
  });

  it('supports static HEAD requests and correct content types', async () => {
    const { route } = fixture();
    const response = await route(
      new Request('waterlily://app/assets/app.js', { method: 'HEAD' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(await response.text()).toBe('');
  });

  it('routes API requests without changing their method or body', async () => {
    const { apiHandler, route } = fixture();
    const request = new Request('waterlily://app/api/workspaces/example', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    });
    const response = await route(request);

    expect(apiHandler).toHaveBeenCalledWith(request);
    expect(await response.json()).toEqual({ service: 'waterlily' });
  });

  it.each([
    ['foreign scheme', 'https://app/index.html', 404],
    ['foreign host', 'waterlily://other/index.html', 404],
    ['missing asset', 'waterlily://app/missing.js', 404],
    ['encoded traversal', 'waterlily://app/%2e%2e%2fsecret', 400],
    ['malformed escape', 'waterlily://app/%E0%A4%A', 400],
    ['encoded backslash', 'waterlily://app/%5csecret', 400],
  ])('rejects a %s', async (_name, url, status) => {
    const { route } = fixture();
    expect((await route(new Request(url))).status).toBe(status);
  });

  it('rejects mutating requests for static resources', async () => {
    const { route } = fixture();
    const response = await route(
      new Request('waterlily://app/index.html', { method: 'POST' }),
    );
    expect(response.status).toBe(405);
  });
});
