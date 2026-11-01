import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, which NestJS dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    // Tests load the collab server and provider as ESM; resolving the
    // protocol package from source keeps one Yjs instance in the process
    // (its CJS build would load a second copy and break CRDT identity).
    alias: {
      '@latex-cloud/collab-protocol': fileURLToPath(
        new URL('../../packages/collab-protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
