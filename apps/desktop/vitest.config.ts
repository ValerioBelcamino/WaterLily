import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/protocolRouter.ts'],
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
