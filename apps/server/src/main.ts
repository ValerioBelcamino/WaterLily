import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  validateWorkspaceState,
  type WorkspaceSnapshot,
} from '@llm-graph/api-contract';
import { openGraphDatabase, WorkspaceRepository } from '@llm-graph/database';
import type { JsonValue } from '@llm-graph/domain';

import { configuredProviders } from './config.js';
import { createNodeServer } from './nodeServer.js';
import { createWorkbenchHandler } from './server.js';
import type { WorkspaceStore } from './types.js';

const databasePath = resolve(
  process.env.WORKBENCH_DATABASE_PATH ?? '.data/workbench.sqlite',
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
const handler = createWorkbenchHandler({
  providers: configuredProviders(process.env),
  workspaces: store,
});
const server = createNodeServer(handler);
const host = process.env.WORKBENCH_HOST ?? '127.0.0.1';
const parsedPort = Number(process.env.WORKBENCH_PORT ?? '4317');
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535)
  throw new Error('WORKBENCH_PORT must be an integer from 1 to 65535');

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(parsedPort, host, () => {
  process.stdout.write(
    `LLM Graph Workbench service listening on http://${host}:${String(parsedPort)}\n`,
  );
});

function shutdown(): void {
  server.close(() => {
    database.close();
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
