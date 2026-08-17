import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/main.ts'),
      fileName: () => 'main.js',
      formats: ['es'],
    },
    minify: false,
    outDir: resolve(import.meta.dirname, 'dist'),
    rollupOptions: {
      external: ['better-sqlite3', 'electron'],
    },
    sourcemap: true,
    ssr: true,
    target: 'node24',
  },
});
