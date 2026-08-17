import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PythonRunner } from '../src/pythonRunner.js';

const temporaryDirectories: string[] = [];

function runner(options: ConstructorParameters<typeof PythonRunner>[1] = {}) {
  const root = mkdtempSync(join(tmpdir(), 'waterlily-python-'));
  temporaryDirectories.push(root);
  return new PythonRunner(root, options);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { force: true, recursive: true });
});

describe('local Python runner', () => {
  it('replays ordered cells, persists graph-local files, and removes secrets', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'must-not-reach-python');
    const python = runner();
    const first = await python.run({
      cells: [
        {
          nodeId: 'node-cell-1',
          source: "value = 40\nopen('value.txt', 'w').write(str(value))",
        },
        {
          nodeId: 'node-cell-2',
          source:
            "import os\nprint(value + 2)\nprint(os.getenv('OPENAI_API_KEY'))",
        },
      ],
      graphId: 'graph-a',
    });
    expect(first).toMatchObject({
      exitCode: 0,
      stderr: '',
      stdout: '42\nNone\n',
      timedOut: false,
      truncated: false,
    });
    expect(first.durationMilliseconds).toBeGreaterThanOrEqual(0);

    const second = await python.run({
      cells: [
        {
          nodeId: 'node-cell-3',
          source: "print(open('value.txt').read())",
        },
      ],
      graphId: 'graph-a',
    });
    expect(second.stdout).toBe('40\n');

    const isolated = await python.run({
      cells: [
        {
          nodeId: 'node-cell-4',
          source: "from pathlib import Path\nprint(Path('value.txt').exists())",
        },
      ],
      graphId: 'graph-b',
    });
    expect(isolated.stdout).toBe('False\n');
  });

  it('captures errors, truncates output, and stops timed-out cells', async () => {
    const syntax = await runner().run({
      cells: [{ nodeId: 'node-bad', source: 'raise ValueError("bad")' }],
      graphId: 'graph-errors',
    });
    expect(syntax.exitCode).toBe(1);
    expect(syntax.stderr).toContain('ValueError: bad');

    const truncated = await runner({ maxOutputBytes: 5 }).run({
      cells: [{ nodeId: 'node-loud', source: "print('abcdefghij')" }],
      graphId: 'graph-output',
    });
    expect(truncated.stdout).toHaveLength(5);
    expect(truncated.truncated).toBe(true);

    const timedOut = await runner({ timeoutMilliseconds: 20 }).run({
      cells: [
        {
          nodeId: 'node-slow',
          source: 'import time\ntime.sleep(2)',
        },
      ],
      graphId: 'graph-timeout',
    });
    expect(timedOut).toMatchObject({ timedOut: true });
  });

  it('supports cancellation and reports missing interpreters safely', async () => {
    const controller = new AbortController();
    const execution = runner().run(
      {
        cells: [
          {
            nodeId: 'node-slow',
            source: 'import time\ntime.sleep(2)',
          },
        ],
        graphId: 'graph-cancel',
      },
      controller.signal,
    );
    controller.abort();
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });

    await expect(
      runner({ executable: 'waterlily-python-does-not-exist' }).run({
        cells: [{ nodeId: 'node-1', source: 'print(1)' }],
        graphId: 'graph-missing',
      }),
    ).rejects.toThrow('could not be started');
  });

  it('validates local resource limits', () => {
    expect(() => runner({ maxOutputBytes: 0 })).toThrow('positive integers');
    expect(() => runner({ timeoutMilliseconds: -1 })).toThrow(
      'positive integers',
    );
  });
});
