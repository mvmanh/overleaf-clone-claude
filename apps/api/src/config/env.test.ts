import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from './env';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_BUCKET: 'latex-cloud',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 'super-secret-value',
  WEB_ORIGIN: 'http://localhost:3000, http://127.0.0.1:3000',
};

describe('loadConfig', () => {
  it('parses and applies defaults', () => {
    const c = loadConfig(valid);
    expect(c.API_PORT).toBe(4000);
    expect(c.WEB_ORIGIN).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(c.COOKIE_SECURE).toBe(false);
  });

  it('reports every missing variable without leaking values', () => {
    try {
      loadConfig({ ...valid, DATABASE_URL: undefined, REDIS_URL: 'nope' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const msg = (e as Error).message;
      expect(msg).toMatch(/DATABASE_URL/);
      expect(msg).toMatch(/REDIS_URL/);
      expect(msg).not.toContain('super-secret-value');
    }
  });

  it('defaults to secure cookies in production and rejects insecure override', () => {
    expect(loadConfig({ ...valid, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
  });
});
