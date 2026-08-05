import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@waterlily/api-contract': fileURLToPath(
        new URL('../../packages/api-contract/src/index.ts', import.meta.url),
      ),
      '@waterlily/context-engine': fileURLToPath(
        new URL('../../packages/context-engine/src/index.ts', import.meta.url),
      ),
      '@waterlily/database': fileURLToPath(
        new URL('../../packages/database/src/index.ts', import.meta.url),
      ),
      '@waterlily/domain': fileURLToPath(
        new URL('../../packages/domain/src/index.ts', import.meta.url),
      ),
      '@waterlily/interchange': fileURLToPath(
        new URL('../../packages/interchange/src/index.ts', import.meta.url),
      ),
      '@waterlily/providers': fileURLToPath(
        new URL('../../packages/providers/src/index.ts', import.meta.url),
      ),
      '@waterlily/workflows': fileURLToPath(
        new URL('../../packages/workflows/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      exclude: ['src/main.ts', 'src/types.ts'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
