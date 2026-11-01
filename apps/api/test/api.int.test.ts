import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiErrorResponse,
  MeResponse,
  ProjectListResponse,
  ReadinessResponse,
} from '@latex-cloud/shared';
import { SEED_PROJECTS } from '../src/database/seed-data';
import { createTestApp, createTestDatabase, TEST_PASSWORD, WEB_ORIGIN } from './helpers';

let app: NestExpressApplication;
let drop: () => Promise<void>;

const [ALICE_NOTES, BOB_PAPER, CAROL_THESIS] = SEED_PROJECTS.map((p) => p.id) as [
  string,
  string,
  string,
];

beforeAll(async () => {
  const db = await createTestDatabase();
  drop = db.drop;
  app = await createTestApp(db.url);
});

afterAll(async () => {
  await app?.close();
  await drop?.();
});

const http = () => request(app.getHttpServer());

async function login(email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await http()
    .post('/api/v1/auth/login')
    .set('Origin', WEB_ORIGIN)
    .send({ email, password })
    .expect(200);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('lc_session='));
  expect(cookie).toBeDefined();
  return cookie!.split(';')[0]!;
}

describe('health', () => {
  it('liveness is public and fast', async () => {
    const res = await http().get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'api' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('readiness reports DB + migrations up and unreachable deps as down (503)', async () => {
    const res = await http().get('/api/v1/health/ready').expect(503);
    const body = ReadinessResponse.parse(res.body);
    expect(body.status).toBe('degraded');
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.migrations.status).toBe('up');
    expect(body.checks.redis.status).toBe('down');
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
  });
});

describe('authentication', () => {
  it('rejects unauthenticated access with the shared error shape', async () => {
    const res = await http()
      .get('/api/v1/projects')
      .set('x-request-id', 'trace-abc-12345')
      .expect(401);
    const body = ApiErrorResponse.parse(res.body);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.requestId).toBe('trace-abc-12345');
  });

  it('rejects wrong passwords and unknown users identically', async () => {
    const wrong = await http()
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'carol@example.com', password: 'nope' })
      .expect(401);
    const unknown = await http()
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'nobody@example.com', password: 'nope' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('validates the login body', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'x' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects state-changing requests from foreign origins (CSRF)', async () => {
    await http()
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'alice@example.com', password: TEST_PASSWORD })
      .expect(403);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: TEST_PASSWORD })
      .expect(403);
  });

  it('issues an httpOnly SameSite session cookie and resolves /me', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'ALICE@example.com ', password: TEST_PASSWORD })
      .expect(200);
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const cookie = setCookie.split(';')[0]!;
    const me = MeResponse.parse(
      (await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200)).body,
    );
    expect(me.user.email).toBe('alice@example.com');
  });

  it('logout revokes the session server-side', async () => {
    const cookie = await login('bob@example.com');
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    await http()
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie)
      .expect(204);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('ignores forged or malformed session tokens', async () => {
    await http()
      .get('/api/v1/auth/me')
      .set('Cookie', 'lc_session=' + 'A'.repeat(43))
      .expect(401);
    await http().get('/api/v1/auth/me').set('Cookie', 'lc_session=../../etc').expect(401);
  });
});

describe('project ACL and tenant separation', () => {
  it('lists only projects the user is a member of, with their role', async () => {
    const alice = await login('alice@example.com');
    const { projects } = ProjectListResponse.parse(
      (await http().get('/api/v1/projects').set('Cookie', alice).expect(200)).body,
    );
    const byId = Object.fromEntries(projects.map((p) => [p.id, p.role]));
    expect(byId).toEqual({ [ALICE_NOTES]: 'owner', [BOB_PAPER]: 'viewer' });
  });

  it('carol sees only her own project', async () => {
    const carol = await login('carol@example.com');
    const { projects } = ProjectListResponse.parse(
      (await http().get('/api/v1/projects').set('Cookie', carol).expect(200)).body,
    );
    expect(projects.map((p) => p.id)).toEqual([CAROL_THESIS]);
    expect(projects[0]!.memberCount).toBe(1);
  });

  it('returns 404 (not 403) for projects the user cannot see, and for malformed ids', async () => {
    const carol = await login('carol@example.com');
    await http().get(`/api/v1/projects/${ALICE_NOTES}`).set('Cookie', carol).expect(404);
    await http().get('/api/v1/projects/not-a-uuid').set('Cookie', carol).expect(404);
    await http()
      .get('/api/v1/projects/00000000-0000-4000-8000-000000000000')
      .set('Cookie', carol)
      .expect(404);
  });

  it('members can read project details', async () => {
    const alice = await login('alice@example.com');
    const res = await http().get(`/api/v1/projects/${BOB_PAPER}`).set('Cookie', alice).expect(200);
    expect(res.body).toMatchObject({
      id: BOB_PAPER,
      role: 'viewer',
      owner: { displayName: 'Bob Tran' },
    });
  });
});

describe('login rate limiting', () => {
  it('throttles repeated failures for an email', async () => {
    const attempt = () =>
      http()
        .post('/api/v1/auth/login')
        .set('Origin', WEB_ORIGIN)
        .send({ email: 'ratelimit@example.com', password: 'wrong' });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.at(-1)).toBe(429);
  });
});
