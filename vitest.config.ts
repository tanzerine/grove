import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // `.tsx` suites render a component to static markup (react-dom/server) to
  // assert on what a customer is actually shown. That needs the automatic JSX
  // runtime and the `@/` alias the app uses; neither affects the `.ts` suites.
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // these tests are pure logic + mocked APIs — no DB, no network, no env needed
    globals: false,
  },
});
