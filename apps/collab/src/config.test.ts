import { describe, expect, it } from 'vitest';
import { DEV_COLLAB_TOKEN_SECRET } from '@latex-cloud/collab-protocol';
import { loadCollabConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000, http://127.0.0.1:3000',
};

describe('collab config', () => {
  it('uses the development secret only in development', () => {
    expect(loadCollabConfig({ ...base, NODE_ENV: 'development' }).COLLAB_TOKEN_SECRET).toBe(
      DEV_COLLAB_TOKEN_SECRET,
    );
    expect(() => loadCollabConfig({ ...base, NODE_ENV: 'test' })).toThrow(/COLLAB_TOKEN_SECRET/);
  });

  it('refuses the development secret and short secrets in production', () => {
    expect(() =>
      loadCollabConfig({
        ...base,
        NODE_ENV: 'production',
        COLLAB_TOKEN_SECRET: DEV_COLLAB_TOKEN_SECRET,
      }),
    ).toThrow(/development default/);
    expect(() =>
      loadCollabConfig({ ...base, NODE_ENV: 'production', COLLAB_TOKEN_SECRET: 'short' }),
    ).toThrow(/COLLAB_TOKEN_SECRET/);
  });

  it('parses origins and never echoes secret values in errors', () => {
    const c = loadCollabConfig({
      ...base,
      NODE_ENV: 'production',
      COLLAB_TOKEN_SECRET: 's'.repeat(40),
    });
    expect(c.WEB_ORIGIN).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(c.COLLAB_PORT).toBe(4100);
    try {
      loadCollabConfig({ ...base, NODE_ENV: 'production', COLLAB_TOKEN_SECRET: 'tiny-secret' });
    } catch (e) {
      expect(String(e)).not.toContain('tiny-secret');
    }
  });
});
