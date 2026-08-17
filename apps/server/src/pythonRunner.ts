import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import type {
  PythonExecutionRequest,
  PythonExecutionResult,
} from '@waterlily/api-contract';

import type { CodeRunner } from './types.js';

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;

export interface PythonRunnerOptions {
  readonly executable?: string;
  readonly maxOutputBytes?: number;
  readonly timeoutMilliseconds?: number;
}

function sourceFor(input: PythonExecutionRequest): string {
  return input.cells
    .map((cell) => `# WaterLily cell: ${cell.nodeId}\n${cell.source}\n`)
    .join('\n');
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ['LANG', 'LC_ALL', 'PATH', 'SYSTEMROOT', 'TMP', 'TEMP'].flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

export class PythonRunner implements CodeRunner {
  readonly #executable: string;
  readonly #maxOutputBytes: number;
  readonly #root: string;
  readonly #timeoutMilliseconds: number;

  public constructor(root: string, options: PythonRunnerOptions = {}) {
    this.#executable = options.executable ?? 'python3';
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.#root = root;
    this.#timeoutMilliseconds =
      options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    if (
      !Number.isSafeInteger(this.#maxOutputBytes) ||
      this.#maxOutputBytes <= 0 ||
      !Number.isSafeInteger(this.#timeoutMilliseconds) ||
      this.#timeoutMilliseconds <= 0
    )
      throw new TypeError('Python runner limits must be positive integers');
    mkdirSync(root, { mode: 0o700, recursive: true });
  }

  public run(
    input: PythonExecutionRequest,
    signal?: AbortSignal,
  ): Promise<PythonExecutionResult> {
    const workspace = join(
      this.#root,
      createHash('sha256').update(input.graphId).digest('hex'),
    );
    mkdirSync(workspace, { mode: 0o700, recursive: true });
    const startedAt = performance.now();

    return new Promise((resolve, reject) => {
      const child = spawn(this.#executable, ['-I', '-u', '-'], {
        cwd: workspace,
        env: safeEnvironment(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let complete = false;
      let outputBytes = 0;
      let stderr = '';
      let stdout = '';
      let timedOut = false;
      let truncated = false;

      const collect = (target: 'stderr' | 'stdout', chunk: Buffer): void => {
        const remaining = this.#maxOutputBytes - outputBytes;
        if (remaining <= 0) {
          truncated = true;
          return;
        }
        const accepted = chunk.subarray(0, remaining);
        outputBytes += accepted.byteLength;
        const decoded = accepted.toString('utf8');
        if (target === 'stdout') stdout += decoded;
        else stderr += decoded;
        if (accepted.byteLength < chunk.byteLength) truncated = true;
      };
      child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));

      const stopOnAbort = (): void => {
        child.kill('SIGKILL');
      };
      signal?.addEventListener('abort', stopOnAbort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, this.#timeoutMilliseconds);

      child.once('error', (error) => {
        if (complete) return;
        complete = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', stopOnAbort);
        reject(
          new Error('The local Python interpreter could not be started.', {
            cause: error,
          }),
        );
      });
      child.once('close', (exitCode) => {
        if (complete) return;
        complete = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', stopOnAbort);
        if (signal?.aborted === true) {
          reject(new DOMException('Python execution canceled', 'AbortError'));
          return;
        }
        resolve({
          durationMilliseconds: Math.max(
            0,
            Math.round(performance.now() - startedAt),
          ),
          exitCode,
          stderr,
          stdout,
          timedOut,
          truncated,
        });
      });
      child.stdin.end(sourceFor(input));
    });
  }
}
