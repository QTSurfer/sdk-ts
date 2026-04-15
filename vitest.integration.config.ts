import { defineConfig } from 'vitest/config';

const verbose =
  process.env.QTSURFER_TEST_VERBOSE === '1' || process.env.QTSURFER_TEST_VERBOSE === 'true';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Integration tests hit a real backend; allow long runs.
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 60 * 1000,
    // QTSURFER_TEST_VERBOSE=1 switches to the verbose reporter so progress
    // and result logs emitted by the tests are visible without editing flags.
    reporters: verbose ? ['verbose'] : ['default'],
  },
});
