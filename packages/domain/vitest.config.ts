import { defineConfig } from 'vitest/config';

export default defineConfig({
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
