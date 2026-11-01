import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ensureRedisConnected } from '../health/dependencies';

export interface RateLimiter {
  /** Records a hit; resolves false when the key is over its limit. */
  hit(key: string): Promise<boolean>;
  reset(key: string): Promise<void>;
}

/**
 * Fixed-window counter in process memory. Used directly in tests and as the
 * fallback when Redis is unreachable (limits then apply per replica).
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): Promise<boolean> {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      this.sweep(t);
      return Promise.resolve(true);
    }
    entry.count += 1;
    return Promise.resolve(entry.count <= this.limit);
  }

  reset(key: string): Promise<void> {
    this.hits.delete(key);
    return Promise.resolve();
  }

  private sweep(t: number): void {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

// INCR and set the window expiry atomically on the first hit.
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c`;

/**
 * Fixed-window counter shared by all API replicas through Redis. If Redis is
 * unavailable it degrades to a per-process limiter rather than either locking
 * everyone out or disabling limiting entirely.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly logger = new Logger('RedisRateLimiter');
  private readonly fallback: FixedWindowRateLimiter;
  private lastWarned = 0;

  constructor(
    private readonly redis: Redis,
    private readonly name: string,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly prefix: string,
  ) {
    this.fallback = new FixedWindowRateLimiter(limit, windowMs);
  }

  private key(k: string): string {
    return `${this.prefix}${this.name}:${k}`;
  }

  async hit(key: string): Promise<boolean> {
    try {
      await ensureRedisConnected(this.redis);
      const count = (await this.redis.eval(
        HIT_SCRIPT,
        1,
        this.key(key),
        String(this.windowMs),
      )) as number;
      return count <= this.limit;
    } catch (err) {
      this.warn(err);
      return this.fallback.hit(key);
    }
  }

  async reset(key: string): Promise<void> {
    await this.fallback.reset(key);
    try {
      await ensureRedisConnected(this.redis);
      await this.redis.del(this.key(key));
    } catch (err) {
      this.warn(err);
    }
  }

  private warn(err: unknown): void {
    if (Date.now() - this.lastWarned < 60_000) return;
    this.lastWarned = Date.now();
    this.logger.warn(
      `falling back to in-process rate limiting: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
