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
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
  },
});
