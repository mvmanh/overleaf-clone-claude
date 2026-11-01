import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limiter';

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit per window then blocks until reset', () => {
    let now = 0;
    const rl = new FixedWindowRateLimiter(2, 1000, () => now);
    expect(rl.hit('a')).toBe(true);
    expect(rl.hit('a')).toBe(true);
    expect(rl.hit('a')).toBe(false);
    expect(rl.hit('b')).toBe(true);
    now = 1000;
    expect(rl.hit('a')).toBe(true);
  });
});
