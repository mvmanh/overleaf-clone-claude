import { describe, expect, it } from 'vitest';
import { LoginRequest, ProjectRole, roleSatisfies } from './index';

describe('roleSatisfies', () => {
  it('orders viewer < editor < owner', () => {
    expect(roleSatisfies('owner', 'editor')).toBe(true);
    expect(roleSatisfies('editor', 'editor')).toBe(true);
    expect(roleSatisfies('viewer', 'editor')).toBe(false);
    expect(roleSatisfies('editor', 'owner')).toBe(false);
  });

  it('rejects unknown roles at the schema boundary', () => {
    expect(ProjectRole.safeParse('admin').success).toBe(false);
  });
});

describe('LoginRequest', () => {
  it('normalises email case and whitespace', () => {
    expect(LoginRequest.parse({ email: '  Alice@Example.COM ', password: 'x' }).email).toBe(
      'alice@example.com',
    );
  });

  it('bounds password length', () => {
    expect(LoginRequest.safeParse({ email: 'a@b.co', password: 'x'.repeat(1025) }).success).toBe(
      false,
    );
  });
});
