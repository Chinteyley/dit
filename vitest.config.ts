import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: srcDir }],
  },
  test: {
    // Engine and input tests run in node; component and hook tests opt into jsdom per file
    // with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'next.config.test.ts'],
    passWithNoTests: true,
    // Every test file starts with a global fetch that throws, so no test reaches the network.
    // The component setup adds the dialog polyfill and the matchMedia stub in jsdom files only.
    setupFiles: ['./src/lib/expansion/test-support/setup.ts', './src/components/test-setup.ts'],
  },
});
