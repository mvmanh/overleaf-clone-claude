import { describe, expect, it } from 'vitest';
import {
  can,
  CreateProjectRequest,
  InviteMemberRequest,
  LoginRequest,
  type ProjectAction,
  ProjectRole,
  roleSatisfies,
  UpdateMemberRequest,
  UpdateProjectRequest,
} from './index';

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

describe('project mutation contracts', () => {
  it('trims names and defaults the engine', () => {
    expect(CreateProjectRequest.parse({ name: '  Thesis  ' })).toEqual({
      name: 'Thesis',
      engine: 'pdflatex',
      template: 'article',
    });
  });

  it.each(['', '   ', 'x'.repeat(201), 'bad\u0000name'])('rejects name %j', (name) => {
    expect(CreateProjectRequest.safeParse({ name }).success).toBe(false);
  });

  it('requires at least one field and rejects unknown fields on update', () => {
    expect(UpdateProjectRequest.safeParse({}).success).toBe(false);
    expect(UpdateProjectRequest.safeParse({ ownerId: 'x' }).success).toBe(false);
    expect(UpdateProjectRequest.safeParse({ engine: 'xelatex' }).success).toBe(true);
  });

  it('never allows granting owner through invite or role change', () => {
    expect(InviteMemberRequest.safeParse({ email: 'a@b.co', role: 'owner' }).success).toBe(false);
    expect(UpdateMemberRequest.safeParse({ role: 'owner' }).success).toBe(false);
  });
});

describe('can', () => {
  it.each<[ProjectRole, ProjectAction, boolean]>([
    ['viewer', 'project:read', true],
    ['viewer', 'project:update', false],
    ['editor', 'project:update', true],
    ['editor', 'members:manage', false],
    ['editor', 'project:delete', false],
    ['owner', 'project:delete', true],
    ['owner', 'members:manage', true],
  ])('%s %s -> %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected);
  });
});
