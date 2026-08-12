import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@llm-graph/context-engine': fileURLToPath(
        new URL('../context-engine/src/index.ts', import.meta.url),
      ),
      '@llm-graph/domain': fileURLToPath(
        new URL('../domain/src/index.ts', import.meta.url),
      ),
      '@llm-graph/interchange': fileURLToPath(
        new URL('../interchange/src/index.ts', import.meta.url),
      ),
      '@llm-graph/providers': fileURLToPath(
        new URL('../providers/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      exclude: ['src/index.ts'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
