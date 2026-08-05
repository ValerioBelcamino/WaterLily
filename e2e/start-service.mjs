import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const dataDirectory = mkdtempSync(join(tmpdir(), 'waterlily-e2e-'));
process.env.WATERLILY_DATABASE_PATH = join(dataDirectory, 'waterlily.sqlite');
process.env.WATERLILY_HOST = '127.0.0.1';
process.env.WATERLILY_PORT = '4317';
process.env.LOCAL_LLM_BASE_URL = 'http://127.0.0.1:4320/v1';
process.env.LOCAL_LLM_MODEL = 'e2e-local';
delete process.env.DEEPSEEK_API_KEY;

process.once('exit', () => {
  rmSync(dataDirectory, { force: true, recursive: true });
});

await import('../apps/server/dist/main.js');
