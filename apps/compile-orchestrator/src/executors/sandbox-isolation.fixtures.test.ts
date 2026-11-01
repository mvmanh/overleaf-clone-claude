import { execFileSync, spawnSync } from 'node:child_process';
import { DEFAULT_SANDBOX_LIMITS } from '@latex-cloud/compiler-protocol';
import { describe, expect, it } from 'vitest';
import { loadOrchestratorEnv } from '../config';
import { buildDockerRunArgs } from './docker';
import { resolveImage } from './factory';

/*
 * Probes the running sandbox with the exact production `docker run` flags
 * (entrypoint swapped for a shell) to verify isolation properties empirically
 * rather than trusting flags. Only meaningful for the docker executor.
 */
const env = loadOrchestratorEnv();
const enabled = env.COMPILE_EXECUTOR === 'docker';

function probe(script: string): { status: number | null; stdout: string; stderr: string } {
  const args = buildDockerRunArgs({
    name: `lc-probe-${process.pid}-${Math.random().toString(36).slice(2)}`,
    image: resolveImage(env.TEX_IMAGE).runRef,
    runtime: env.DOCKER_RUNTIME,
    limits: { ...DEFAULT_SANDBOX_LIMITS, pids: 64 },
    rootFile: '-c',
    latexmkArgs: [script],
    entrypoint: '/bin/sh',
  });
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000, input: '' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe.runIf(enabled)('docker sandbox isolation', () => {
  it('docker is available', () => {
    expect(() => execFileSync('docker', ['version'], { stdio: 'ignore' })).not.toThrow();
  });

  it('runs as the unprivileged sandbox user with no capabilities', () => {
    const r = probe('id -u; grep CapEff /proc/self/status; grep NoNewPrivs /proc/self/status');
    expect(r.stdout).toMatch(/^10001$/m);
    expect(r.stdout).toMatch(/CapEff:\s*0+$/m);
    expect(r.stdout).toMatch(/NoNewPrivs:\s*1$/m);
  });

  it('has a read-only root filesystem', () => {
    const r = probe('touch /usr/local/bin/x 2>&1; touch /etc/x 2>&1; echo done');
    expect(r.stdout).toMatch(/Read-only file system/);
    expect(r.stdout).toContain('done');
  });

  it('has no network interfaces besides loopback and cannot resolve or connect', () => {
    const r = probe(
      'ls /sys/class/net; (exec 3<>/dev/tcp/1.1.1.1/80) 2>&1 || echo no-connect; getent hosts example.com || echo no-dns',
    );
    expect(r.stdout.split('\n').filter((l) => /^[a-z0-9]+$/.test(l) && l !== 'lo')).toEqual([]);
    expect(r.stdout).toContain('no-dns');
  });

  it('scratch space is noexec', () => {
    const r = probe('cp /bin/true /work/t && /work/t && echo executed || echo blocked');
    expect(r.stdout).toContain('blocked');
  });

  it('cannot see host processes or the docker socket', () => {
    const r = probe(
      'ls /proc | grep -E "^[0-9]+$" | wc -l; test -e /var/run/docker.sock && echo has-sock || echo no-sock',
    );
    expect(r.stdout).toContain('no-sock');
    expect(Number(r.stdout.trim().split('\n')[0])).toBeLessThan(10);
  });

  it('enforces the pids limit (fork bomb is contained)', () => {
    const r = probe(
      'i=0; while [ $i -lt 200 ]; do sleep 5 & i=$((i+1)); done 2>/dev/null; echo spawned; jobs -p | wc -l',
    );
    const lines = r.stdout.trim().split('\n');
    expect(Number(lines.at(-1))).toBeLessThan(64);
  });

  it('contains no credentials or orchestrator environment', () => {
    const r = probe('env');
    expect(r.stdout).not.toMatch(/AWS_|S3_|DATABASE_URL|REDIS_URL|TOKEN|SECRET|PASSWORD/i);
  });
});
