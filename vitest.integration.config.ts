import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Integration tests hit a real backend; allow long runs.
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});
