import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { createLocalWaterLilyService } from './localService.js';
import { createNodeServer } from './nodeServer.js';

const databasePath = resolve(
  process.env.WATERLILY_DATABASE_PATH ?? '.data/waterlily.sqlite',
);
const dataDirectory = dirname(databasePath);
const credentialsPath = resolve(
  process.env.WATERLILY_CREDENTIALS_PATH ??
    join(
      process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
      'waterlily',
      'credentials.json',
    ),
);
const service = createLocalWaterLilyService({
  attachmentsPath: resolve(
    process.env.WATERLILY_ATTACHMENTS_PATH ??
      join(dataDirectory, 'attachments'),
  ),
  credentialsPath,
  dataDirectory,
  databasePath,
  environment: process.env,
  ...(process.env.WATERLILY_PYTHON_EXECUTABLE === undefined
    ? {}
    : { pythonExecutable: process.env.WATERLILY_PYTHON_EXECUTABLE }),
  pythonWorkspacesPath: resolve(
    process.env.WATERLILY_PYTHON_WORKSPACES_PATH ??
      join(dataDirectory, 'python'),
  ),
});
const server = createNodeServer(service.handler);
const host = process.env.WATERLILY_HOST ?? '127.0.0.1';
const parsedPort = Number(process.env.WATERLILY_PORT ?? '4317');
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535)
  throw new Error('WATERLILY_PORT must be an integer from 1 to 65535');

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(parsedPort, host, () => {
  process.stdout.write(
    `WaterLily service listening on http://${host}:${String(parsedPort)}\n`,
  );
});

function shutdown(): void {
  server.close(() => {
    service.close();
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
