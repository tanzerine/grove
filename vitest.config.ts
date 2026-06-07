import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // these tests are pure logic + mocked APIs — no DB, no network, no env needed
    globals: false,
  },
});
