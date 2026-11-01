import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('produces argon2id PHC hashes that verify', async () => {
    const h = await hasher.hash('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(h, 'correct horse battery staple')).toBe(true);
    expect(await hasher.verify(h, 'wrong')).toBe(false);
  });

  it('treats malformed hashes as a failed verification', async () => {
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
  });

  it('dummy verification always fails', async () => {
    expect(await hasher.verifyAgainstDummy('anything')).toBe(false);
  });
});
