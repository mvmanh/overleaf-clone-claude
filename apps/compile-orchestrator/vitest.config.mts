import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.fixtures.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'fixtures',
          include: ['src/**/*.fixtures.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 600_000,
        },
      },
    ],
  },
});
