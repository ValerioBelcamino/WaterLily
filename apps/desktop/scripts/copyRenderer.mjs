import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const rendererSource = resolve(import.meta.dirname, '../../web/dist');
const rendererTarget = resolve(import.meta.dirname, '../dist/renderer');

if (!existsSync(resolve(rendererSource, 'index.html')))
  throw new Error(
    'The web renderer is not built. Run the workspace build before packaging.',
  );

rmSync(rendererTarget, { force: true, recursive: true });
cpSync(rendererSource, rendererTarget, { recursive: true });
