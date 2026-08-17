import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalWaterLilyService } from '../src/localService.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { force: true, recursive: true });
});

describe('embedded local service', () => {
  it('owns local persistence without opening a network listener', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'waterlily-service-'));
    temporaryDirectories.push(dataDirectory);
    const service = createLocalWaterLilyService({
      dataDirectory,
      environment: {},
    });

    const response = await service.handler(
      new Request('waterlily://app/api/health'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providers: expect.any(Array) as unknown,
      service: 'waterlily',
      version: '0.0.0',
    });
    expect(existsSync(join(dataDirectory, 'waterlily.sqlite'))).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(dataDirectory).mode & 0o777).toBe(0o700);
      expect(
        statSync(join(dataDirectory, 'waterlily.sqlite')).mode & 0o777,
      ).toBe(0o600);
    }

    service.close();
    expect(() => service.close()).not.toThrow();
  });
});
