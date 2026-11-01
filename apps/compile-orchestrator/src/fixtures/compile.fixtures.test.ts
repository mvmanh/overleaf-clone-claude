import type { SandboxExecutor } from '@latex-cloud/compiler-protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOrchestratorEnv } from '../config';
import { createExecutor } from '../executors/factory';
import { type Fixture, loadFixtures, runFixture } from './load';

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
