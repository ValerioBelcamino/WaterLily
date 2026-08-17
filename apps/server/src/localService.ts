import { chmodSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  validateWorkspaceState,
  type WorkspaceSnapshot,
} from '@waterlily/api-contract';
import {
  openGraphDatabase,
  type Migration,
  WorkspaceRepository,
} from '@waterlily/database';
import type { JsonValue } from '@waterlily/domain';

import { FileAttachmentStore } from './attachments.js';
import { configuredProviders } from './config.js';
import { CredentialProviderRegistry } from './credentials.js';
import { PythonRunner } from './pythonRunner.js';
import { createWaterLilyHandler } from './server.js';
import type { WorkspaceStore } from './types.js';

type Environment = Readonly<Record<string, string | undefined>>;

export interface LocalWaterLilyServiceOptions {
  readonly attachmentsPath?: string;
  readonly credentialsPath?: string;
  readonly dataDirectory: string;
  readonly databasePath?: string;
  readonly environment?: Environment;
  readonly enableHostPython?: boolean;
  readonly migrations?: readonly Migration[];
  readonly pythonExecutable?: string;
  readonly pythonWorkspacesPath?: string;
}

export interface LocalWaterLilyService {
  close(): void;
  readonly handler: (request: Request) => Promise<Response>;
}

/**
 * Creates the complete local application service without opening a network
 * socket. Desktop shells can route their private origin directly to `handler`.
 */
export function createLocalWaterLilyService(
  options: LocalWaterLilyServiceOptions,
): LocalWaterLilyService {
  const environment = options.environment ?? process.env;
  const dataDirectory = resolve(options.dataDirectory);
  const databasePath = resolve(
    options.databasePath ?? join(dataDirectory, 'waterlily.sqlite'),
  );
  const attachmentsPath = resolve(
    options.attachmentsPath ?? join(dataDirectory, 'attachments'),
  );
  const credentialsPath = resolve(
    options.credentialsPath ?? join(dataDirectory, 'credentials.json'),
  );
  const pythonWorkspacesPath = resolve(
    options.pythonWorkspacesPath ?? join(dataDirectory, 'python'),
  );

  mkdirSync(dataDirectory, { mode: 0o700, recursive: true });
  chmodSync(dataDirectory, 0o700);
  const attachments = new FileAttachmentStore(attachmentsPath);
  const providerProfiles = new CredentialProviderRegistry({
    attachments,
    path: credentialsPath,
  });
  const codeRunner =
    options.enableHostPython === false
      ? undefined
      : new PythonRunner(pythonWorkspacesPath, {
          ...(options.pythonExecutable === undefined
            ? {}
            : { executable: options.pythonExecutable }),
        });
  const database = openGraphDatabase(databasePath, {
    ...(options.migrations === undefined
      ? {}
      : { migrations: options.migrations }),
  });
  chmodSync(databasePath, 0o600);
  const repository = new WorkspaceRepository(database.db);
  const workspaces: WorkspaceStore = {
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
  let closed = false;

  return {
    close() {
      if (closed) return;
      closed = true;
      database.close();
    },
    handler: createWaterLilyHandler({
      attachments,
      ...(codeRunner === undefined ? {} : { codeRunner }),
      providerProfiles,
      providers: () => [
        ...configuredProviders(environment, attachments),
        ...providerProfiles.registrations(),
      ],
      workspaces,
    }),
  };
}
