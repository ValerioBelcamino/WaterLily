import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  validateWorkspaceState,
  type WorkspaceSnapshot,
} from '@waterlily/api-contract';
import { openGraphDatabase, WorkspaceRepository } from '@waterlily/database';
import type { JsonValue } from '@waterlily/domain';

import { configuredProviders } from './config.js';
import { FileAttachmentStore } from './attachments.js';
import { CredentialProviderRegistry } from './credentials.js';
import { createNodeServer } from './nodeServer.js';
import { PythonRunner } from './pythonRunner.js';
import { createWaterLilyHandler } from './server.js';
import type { WorkspaceStore } from './types.js';

const databasePath = resolve(
  process.env.WATERLILY_DATABASE_PATH ?? '.data/waterlily.sqlite',
);
const dataDirectory = dirname(databasePath);
const attachments = new FileAttachmentStore(
  resolve(
    process.env.WATERLILY_ATTACHMENTS_PATH ??
      join(dataDirectory, 'attachments'),
  ),
);
const credentialsPath = resolve(
  process.env.WATERLILY_CREDENTIALS_PATH ??
    join(
      process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
      'waterlily',
      'credentials.json',
    ),
);
const credentialProviders = new CredentialProviderRegistry({
  attachments,
  path: credentialsPath,
});
const codeRunner = new PythonRunner(
  resolve(
    process.env.WATERLILY_PYTHON_WORKSPACES_PATH ??
      join(dataDirectory, 'python'),
  ),
  {
    ...(process.env.WATERLILY_PYTHON_EXECUTABLE === undefined
      ? {}
      : { executable: process.env.WATERLILY_PYTHON_EXECUTABLE }),
  },
);
mkdirSync(dirname(databasePath), { recursive: true });
const database = openGraphDatabase(databasePath);
const repository = new WorkspaceRepository(database.db);
const store: WorkspaceStore = {
  get(graphId) {
    const workspace = repository.get(graphId);
    if (workspace === null) return null;
    return {
      graph: workspace.graph,
      state: validateWorkspaceState(workspace.graph, workspace.state),
    };
  },
  insert(workspace: WorkspaceSnapshot) {
    repository.insert({
      graph: workspace.graph,
      state: workspace.state as unknown as JsonValue,
    });
  },
  replace(workspace: WorkspaceSnapshot, expectedUpdatedAt: string) {
    repository.replace(
      {
        graph: workspace.graph,
        state: workspace.state as unknown as JsonValue,
      },
      expectedUpdatedAt,
    );
  },
};
const handler = createWaterLilyHandler({
  attachments,
  codeRunner,
  providerProfiles: credentialProviders,
  providers: () => [
    ...configuredProviders(process.env, attachments),
    ...credentialProviders.registrations(),
  ],
  workspaces: store,
});
const server = createNodeServer(handler);
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
    database.close();
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
