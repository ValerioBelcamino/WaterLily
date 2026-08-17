import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const stageDirectory = resolve(import.meta.dirname, '../.package');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

rmSync(stageDirectory, { force: true, recursive: true });
const result = spawnSync(
  pnpm,
  [
    '--config.inject-workspace-packages=true',
    '--filter',
    '@waterlily/desktop',
    'deploy',
    '--prod',
    stageDirectory,
  ],
  {
    cwd: workspaceRoot,
    env: { ...process.env, CI: process.env.CI ?? 'true' },
    stdio: 'inherit',
  },
);

if (result.error !== undefined) throw result.error;
if (result.status !== 0)
  throw new Error(`pnpm deploy exited with status ${String(result.status)}`);

// Deploy retains the development dependency declarations even though it omits
// their files. Packager crawls declared dependencies, so keep only Electron's
// version declaration and let the invoking workspace provide Forge itself.
const packagePath = resolve(stageDirectory, 'package.json');
const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8'));
for (const name of Object.keys(packageManifest.dependencies)) {
  const dependencyManifest = JSON.parse(
    readFileSync(
      resolve(stageDirectory, 'node_modules', name, 'package.json'),
      'utf8',
    ),
  );
  packageManifest.dependencies[name] = dependencyManifest.version;
}
const electronManifest = JSON.parse(
  readFileSync(
    resolve(workspaceRoot, 'node_modules/electron/package.json'),
    'utf8',
  ),
);
packageManifest.config = { forge: './forge.config.ts' };
packageManifest.devDependencies = {
  electron: electronManifest.version,
};
writeFileSync(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
