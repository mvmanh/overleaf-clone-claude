import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with OWASP-recommended minimum parameters (19 MiB, t=2, p=1).
 * Hashes are self-describing PHC strings, so parameters can be raised later
 * and old hashes still verify (rehash-on-login can be added then).
 */
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Burns the same CPU as a real verification. Called when the account does
   * not exist so response timing does not reveal registered emails.
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-equalisation');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
