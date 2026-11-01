import {
  DEFAULT_SANDBOX_LIMITS,
  MAX_BUILD_CACHE_BYTES,
  type SandboxExecutor,
  unpackSnapshot,
} from '@latex-cloud/compiler-protocol';
import { MemoryArtifactWriter } from '../executors/memory-writer';
import { createSnapshot } from '../snapshot';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOrchestratorEnv } from '../config';
import { createExecutor } from '../executors/factory';
import { type Fixture, loadFixtures, pagesFromLog, runFixture } from './load';

/*
 * Compiles every fixture through the configured executor (COMPILE_EXECUTOR).
 * This suite never silently skips: without a working executor it fails.
 */
const fixtures: Fixture[] = loadFixtures();
let executor: SandboxExecutor;

beforeAll(() => {
  executor = createExecutor(loadOrchestratorEnv());
});

describe('compile fixtures', () => {
  it('has fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_, fixture) => {
    const outcome = await runFixture(executor, fixture);
    expect(outcome.failures).toEqual([]);
  });
});

describe('incremental build cache', () => {
  it.each(['biber', 'math'])(
    '%s: a rebuild from the cache succeeds with the same page count',
    async (name) => {
      const fixture = fixtures.find((f) => f.name === name)!;
      const snapshot = createSnapshot({
        files: fixture.files,
        rootFile: fixture.spec.rootFile,
        engine: fixture.spec.engine,
        texImage: executor.descriptor.texImage,
      });
      const cfg = { engine: fixture.spec.engine, rootFile: fixture.spec.rootFile };
      const first = await executor.run(
        snapshot,
        cfg,
        DEFAULT_SANDBOX_LIMITS,
        new MemoryArtifactWriter(),
      );
      expect(first.outcome).toBe('succeeded');
      expect(first.buildCache).toBeDefined();
      const cache = await unpackSnapshot(Buffer.from(first.buildCache!), {
        maxFiles: 2000,
        maxTotalBytes: MAX_BUILD_CACHE_BYTES,
      });
      expect(cache.some((f) => f.path.endsWith('.aux'))).toBe(true);

      const writer = new MemoryArtifactWriter();
      const second = await executor.run(
        snapshot,
        { ...cfg, cache },
        DEFAULT_SANDBOX_LIMITS,
        writer,
      );
      expect(second).toMatchObject({ outcome: 'succeeded', usedCache: true });
      const log = Buffer.from(writer.artifacts.get('log')!.data).toString();
      expect(pagesFromLog(log)).toBeGreaterThanOrEqual(fixture.spec.expect.minPages ?? 1);
    },
  );
});
