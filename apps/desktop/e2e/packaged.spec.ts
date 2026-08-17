import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, expect, test } from '@playwright/test';

const defaultExecutable = resolve(
  import.meta.dirname,
  '../.package/out/WaterLily-linux-x64/waterlily',
);

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Could not allocate a loopback port');
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) =>
      error === undefined ? resolveClosed() : reject(error),
    );
  });
  return address.port;
}

async function waitForDebugEndpoint(
  port: number,
  process: ChildProcess,
  errors: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null)
      throw new Error(`WaterLily exited before its window opened: ${errors()}`);
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(port)}/json/version`,
      );
      if (response.ok) return;
    } catch {
      // The debugging server is not listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`WaterLily did not open a window: ${errors()}`);
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) =>
      process.once('exit', () => resolveExit()),
    ),
    new Promise<void>((resolveDelay) =>
      setTimeout(() => {
        if (process.exitCode === null) process.kill('SIGKILL');
        resolveDelay();
      }, 5_000),
    ),
  ]);
}

test('the packaged desktop app boots with its private API and sandboxed UI', async () => {
  const executablePath = resolve(
    process.env.WATERLILY_DESKTOP_EXECUTABLE ?? defaultExecutable,
  );
  expect(existsSync(executablePath)).toBe(true);
  const userData = mkdtempSync(join(tmpdir(), 'waterlily-desktop-e2e-'));
  const port = await freeLoopbackPort();
  let errors = '';
  const application = spawn(
    executablePath,
    [`--remote-debugging-port=${String(port)}`],
    {
      env: {
        ...process.env,
        WATERLILY_DESKTOP_USER_DATA: userData,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  application.stderr.on('data', (chunk: Buffer) => {
    errors = `${errors}${chunk.toString('utf8')}`.slice(-8_000);
  });

  try {
    await waitForDebugEndpoint(port, application, () => errors);
    const browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${String(port)}`,
    );
    try {
      const context = browser.contexts()[0];
      if (context === undefined)
        throw new Error('The packaged app has no browser context');
      const window = context.pages()[0] ?? (await context.waitForEvent('page'));
      await expect(window).toHaveURL('waterlily://app/');
      await expect(
        window.getByRole('heading', { name: 'Oxidative phosphorylation' }),
      ).toBeVisible();
      await expect(window.getByText('online', { exact: true })).toBeVisible();
      expect(
        await window.evaluate(() => ({
          nodeRequire: typeof Reflect.get(window, 'require'),
          process: typeof Reflect.get(window, 'process'),
        })),
      ).toEqual({ nodeRequire: 'undefined', process: 'undefined' });
      expect(
        await window.evaluate(async () => {
          const response = await fetch('/api/health');
          return {
            body: (await response.json()) as unknown,
            status: response.status,
          };
        }),
      ).toMatchObject({
        body: { service: 'waterlily', version: '0.0.0' },
        status: 200,
      });
      expect(
        await window.evaluate(async () => {
          const response = await fetch('/api/executions/python', {
            body: '{}',
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          });
          return {
            body: (await response.json()) as unknown,
            status: response.status,
          };
        }),
      ).toEqual({
        body: {
          error: {
            code: 'HTTP_503',
            message: 'Local Python execution is unavailable',
          },
        },
        status: 503,
      });
      expect(existsSync(join(userData, 'data', 'waterlily.sqlite'))).toBe(true);
      if (process.platform !== 'win32')
        expect(statSync(join(userData, 'data')).mode & 0o777).toBe(0o700);
      await window.close();
    } finally {
      await browser.close();
    }
  } finally {
    await stop(application);
    rmSync(userData, { force: true, recursive: true });
  }
});
