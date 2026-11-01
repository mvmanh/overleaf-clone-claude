import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { FixedWindowRateLimiter, RedisRateLimiter } from './rate-limiter';

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit per window then blocks until reset', async () => {
    let now = 0;
    const rl = new FixedWindowRateLimiter(2, 1000, () => now);
    expect(await rl.hit('a')).toBe(true);
    expect(await rl.hit('a')).toBe(true);
    expect(await rl.hit('a')).toBe(false);
    expect(await rl.hit('b')).toBe(true);
    now = 1000;
    expect(await rl.hit('a')).toBe(true);
  });
});

describe('RedisRateLimiter', () => {
  it('falls back to in-process limiting when Redis fails', async () => {
    const broken = {
      status: 'ready',
      eval: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
    } as unknown as Redis;
    const rl = new RedisRateLimiter(broken, 'login', 1, 60_000, 't:');
    expect(await rl.hit('x')).toBe(true);
    expect(await rl.hit('x')).toBe(false);
    await rl.reset('x');
    expect(await rl.hit('x')).toBe(true);
  });

  it('uses the namespaced key and the shared counter', async () => {
    const calls: unknown[][] = [];
    let n = 0;
    const fake = {
      status: 'ready',
      eval: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(++n);
      },
    } as unknown as Redis;
    const rl = new RedisRateLimiter(fake, 'login-email', 2, 900_000, 'lc:rl:');
    expect(await rl.hit('a@b.co')).toBe(true);
    expect(await rl.hit('a@b.co')).toBe(true);
    expect(await rl.hit('a@b.co')).toBe(false);
    expect(calls[0]?.slice(1)).toEqual([1, 'lc:rl:login-email:a@b.co', '900000']);
  });
});
