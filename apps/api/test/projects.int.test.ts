import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectListResponse,
  ProjectMembersResponse,
  type ProjectRole,
  ProjectSummary,
} from '@latex-cloud/shared';
import { SEED_PROJECTS } from '../src/database/seed-data';
import {
  createTestApp,
  createTestDatabase,
  loginCookie,
  REDIS_AVAILABLE,
  WEB_ORIGIN,
} from './helpers';

let app: NestExpressApplication;
let dbUrl: string;
let drop: () => Promise<void>;
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

beforeAll(async () => {
  const db = await createTestDatabase();
  dbUrl = db.url;
  drop = db.drop;
  app = await createTestApp(db.url);
  for (const name of ['alice', 'bob', 'carol']) {
    cookies[name] = await loginCookie(app, `${name}@example.com`);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookies[name]!);
    ids[name] = me.body.user.id;
  }
});

afterAll(async () => {
  await app?.close();
  await drop?.();
});

const as = (who: string) => {
  const server = app.getHttpServer();
  const c = cookies[who] ?? '';
  return {
    get: (url: string) => request(server).get(url).set('Cookie', c),
    post: (url: string) => request(server).post(url).set('Origin', WEB_ORIGIN).set('Cookie', c),
    patch: (url: string) => request(server).patch(url).set('Origin', WEB_ORIGIN).set('Cookie', c),
    delete: (url: string) => request(server).delete(url).set('Origin', WEB_ORIGIN).set('Cookie', c),
  };
};

async function auditActions(projectId: string): Promise<string[]> {
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  const r = await c.query<{ action: string }>(
    'select action from project_audit_events where project_id = $1 order by id',
    [projectId],
  );
  await c.end();
  return r.rows.map((row) => row.action);
}

/** Fresh project owned by alice, with bob as editor and carol as viewer. */
async function fixtureProject(): Promise<string> {
  const res = await as('alice').post('/api/v1/projects').send({ name: 'Fixture' }).expect(201);
  const id = ProjectSummary.parse(res.body).id;
  await as('alice')
    .post(`/api/v1/projects/${id}/members/invite`)
    .send({ email: 'bob@example.com', role: 'editor' })
    .expect(201);
  await as('alice')
    .post(`/api/v1/projects/${id}/members/invite`)
    .send({ email: 'carol@example.com', role: 'viewer' })
    .expect(201);
  return id;
}

describe('create', () => {
  it('creates a project owned by the caller, visible only to them, with an audit event', async () => {
    const res = await as('carol')
      .post('/api/v1/projects')
      .send({ name: '  Đại số tuyến tính  ', engine: 'xelatex' })
      .expect(201);
    const p = ProjectSummary.parse(res.body);
    expect(p).toMatchObject({
      name: 'Đại số tuyến tính',
      engine: 'xelatex',
      role: 'owner',
      memberCount: 1,
    });
    expect(p.owner.id).toBe(ids.carol);

    const carolList = ProjectListResponse.parse((await as('carol').get('/api/v1/projects')).body);
    expect(carolList.projects[0]?.id).toBe(p.id); // most recently updated first
    const bobList = ProjectListResponse.parse((await as('bob').get('/api/v1/projects')).body);
    expect(bobList.projects.some((x) => x.id === p.id)).toBe(false);
    expect(await auditActions(p.id)).toEqual(['project.created']);
  });

  it('validates input and rejects unknown engines', async () => {
    const res = await as('alice').post('/api/v1/projects').send({ name: '   ' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    await as('alice').post('/api/v1/projects').send({ name: 'x', engine: 'tectonic' }).expect(400);
  });

  it('requires authentication and an allowed origin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Origin', WEB_ORIGIN)
      .send({ name: 'x' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Cookie', cookies.alice!)
      .set('Origin', 'https://evil.example')
      .send({ name: 'x' })
      .expect(403);
  });
});

describe('role matrix', () => {
  let projectId: string;
  beforeAll(async () => {
    projectId = await fixtureProject();
  });

  // [caller, expected status] per action. "dave" = authenticated non-member (no cookie mapping → anonymous handled separately).
  const cases: {
    action: string;
    run: (who: string) => request.Test;
    expect: Record<string, number>;
  }[] = [
    {
      action: 'GET project',
      run: (w) => as(w).get(`/api/v1/projects/${projectId}`),
      expect: { alice: 200, bob: 200, carol: 200 },
    },
    {
      action: 'PATCH name',
      run: (w) =>
        as(w)
          .patch(`/api/v1/projects/${projectId}`)
          .send({ name: `n-${w}` }),
      expect: { alice: 200, bob: 200, carol: 403 },
    },
    {
      action: 'GET members',
      run: (w) => as(w).get(`/api/v1/projects/${projectId}/members`),
      expect: { alice: 200, bob: 200, carol: 200 },
    },
    {
      action: 'invite',
      run: (w) =>
        as(w)
          .post(`/api/v1/projects/${projectId}/members/invite`)
          .send({ email: 'nobody-yet@example.com', role: 'viewer' }),
      expect: { alice: 404, bob: 403, carol: 403 },
    },
    {
      action: 'change role',
      run: (w) =>
        as(w).patch(`/api/v1/projects/${projectId}/members/${ids.carol}`).send({ role: 'viewer' }),
      expect: { alice: 200, bob: 403, carol: 403 },
    },
    {
      action: 'remove other',
      run: (w) => as(w).delete(`/api/v1/projects/${projectId}/members/${ids.alice}`),
      expect: { alice: 409, bob: 403, carol: 403 },
    },
    {
      action: 'transfer',
      run: (w) =>
        as(w).post(`/api/v1/projects/${projectId}/transfer-ownership`).send({ userId: ids.alice }),
      expect: { alice: 409, bob: 403, carol: 403 },
    },
    {
      action: 'DELETE project',
      run: (w) => as(w).delete(`/api/v1/projects/${projectId}`),
      expect: { bob: 403, carol: 403 },
    },
  ];

  for (const c of cases) {
    for (const [who, status] of Object.entries(c.expect)) {
      it(`${c.action} as ${who} -> ${status}`, async () => {
        await c.run(who).expect(status);
      });
    }
  }

  it('non-members get 404 for every project endpoint (no existence oracle)', async () => {
    const outsider = SEED_PROJECTS.find((p) => p.owner === 'carol@example.com')!.id; // alice is not a member
    await as('alice').get(`/api/v1/projects/${outsider}`).expect(404);
    await as('alice').patch(`/api/v1/projects/${outsider}`).send({ name: 'x' }).expect(404);
    await as('alice').delete(`/api/v1/projects/${outsider}`).expect(404);
    await as('alice').get(`/api/v1/projects/${outsider}/members`).expect(404);
    await as('alice')
      .post(`/api/v1/projects/${outsider}/members/invite`)
      .send({ email: 'bob@example.com', role: 'editor' })
      .expect(404);
    await as('alice')
      .post(`/api/v1/projects/${outsider}/transfer-ownership`)
      .send({ userId: ids.alice })
      .expect(404);
    await as('alice').get('/api/v1/projects/not-a-uuid/members').expect(404);
  });

  it('anonymous callers get 401 everywhere', async () => {
    const server = app.getHttpServer();
    await request(server).get(`/api/v1/projects/${projectId}/members`).expect(401);
    await request(server)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Origin', WEB_ORIGIN)
      .send({ name: 'x' })
      .expect(401);
  });
});

describe('update', () => {
  it('records changes in the audit log', async () => {
    const id = await fixtureProject();
    const res = await as('bob')
      .patch(`/api/v1/projects/${id}`)
      .send({ name: 'Renamed', engine: 'lualatex' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Renamed', engine: 'lualatex', role: 'editor' });
    await as('alice').patch(`/api/v1/projects/${id}`).send({ ownerId: ids.bob }).expect(400);
    expect(await auditActions(id)).toEqual([
      'project.created',
      'member.added',
      'member.added',
      'project.updated',
    ]);
  });
});

describe('members', () => {
  it('invite, list, change role, remove — access follows immediately', async () => {
    const res = await as('alice').post('/api/v1/projects').send({ name: 'Members' }).expect(201);
    const id = res.body.id as string;

    await as('bob').get(`/api/v1/projects/${id}`).expect(404);
    const invited = await as('alice')
      .post(`/api/v1/projects/${id}/members/invite`)
      .send({ email: 'BOB@example.com', role: 'editor' })
      .expect(201);
    const roles = Object.fromEntries(
      ProjectMembersResponse.parse(invited.body).members.map((m) => [m.email, m.role]),
    );
    expect(roles).toEqual({ 'alice@example.com': 'owner', 'bob@example.com': 'editor' });

    await as('bob').patch(`/api/v1/projects/${id}`).send({ name: 'by bob' }).expect(200);
    await as('alice')
      .patch(`/api/v1/projects/${id}/members/${ids.bob}`)
      .send({ role: 'viewer' })
      .expect(200);
    await as('bob').patch(`/api/v1/projects/${id}`).send({ name: 'by bob again' }).expect(403);

    await as('alice').delete(`/api/v1/projects/${id}/members/${ids.bob}`).expect(204);
    await as('bob').get(`/api/v1/projects/${id}`).expect(404);
    expect(await auditActions(id)).toEqual([
      'project.created',
      'member.added',
      'project.updated',
      'member.role_changed',
      'member.removed',
    ]);
  });

  it('rejects duplicate invites, owner grants, and unknown members', async () => {
    const id = await fixtureProject();
    const dup = await as('alice')
      .post(`/api/v1/projects/${id}/members/invite`)
      .send({ email: 'bob@example.com', role: 'viewer' })
      .expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    await as('alice')
      .post(`/api/v1/projects/${id}/members/invite`)
      .send({ email: 'alice@example.com', role: 'viewer' })
      .expect(409);
    await as('alice')
      .post(`/api/v1/projects/${id}/members/invite`)
      .send({ email: 'bob@example.com', role: 'owner' })
      .expect(400);
    await as('alice')
      .patch(`/api/v1/projects/${id}/members/${ids.bob}`)
      .send({ role: 'owner' })
      .expect(400);
    await as('alice')
      .patch(`/api/v1/projects/${id}/members/${ids.alice}`)
      .send({ role: 'viewer' })
      .expect(409);
    await as('alice')
      .patch(`/api/v1/projects/${id}/members/00000000-0000-4000-8000-000000000000`)
      .send({ role: 'viewer' })
      .expect(404);
  });

  it('non-owners can leave; owners cannot', async () => {
    const id = await fixtureProject();
    await as('carol').delete(`/api/v1/projects/${id}/members/${ids.carol}`).expect(204);
    await as('carol').get(`/api/v1/projects/${id}`).expect(404);
    await as('alice').delete(`/api/v1/projects/${id}/members/${ids.alice}`).expect(409);
    expect((await auditActions(id)).at(-1)).toBe('member.left');
  });
});

describe('ownership transfer', () => {
  it('moves ownership atomically: old owner becomes editor', async () => {
    const id = await fixtureProject();
    const res = await as('alice')
      .post(`/api/v1/projects/${id}/transfer-ownership`)
      .send({ userId: ids.carol })
      .expect(200);
    expect(res.body).toMatchObject({ role: 'editor', owner: { id: ids.carol } });

    const members = ProjectMembersResponse.parse(
      (await as('carol').get(`/api/v1/projects/${id}/members`)).body,
    ).members;
    const roleOf = (uid: string) => members.find((m) => m.userId === uid)?.role;
    expect([roleOf(ids.carol!), roleOf(ids.alice!), roleOf(ids.bob!)]).toEqual<ProjectRole[]>([
      'owner',
      'editor',
      'editor',
    ]);

    await as('alice').delete(`/api/v1/projects/${id}`).expect(403);
    await as('alice')
      .post(`/api/v1/projects/${id}/transfer-ownership`)
      .send({ userId: ids.alice })
      .expect(403);
  });

  it('cannot transfer to a non-member', async () => {
    const res = await as('alice').post('/api/v1/projects').send({ name: 'Solo' }).expect(201);
    await as('alice')
      .post(`/api/v1/projects/${res.body.id}/transfer-ownership`)
      .send({ userId: ids.bob })
      .expect(404);
  });

  it('keeps exactly one owner under concurrent transfers', async () => {
    const id = await fixtureProject();
    const results = await Promise.all([
      as('alice').post(`/api/v1/projects/${id}/transfer-ownership`).send({ userId: ids.bob }),
      as('alice').post(`/api/v1/projects/${id}/transfer-ownership`).send({ userId: ids.carol }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const members = ProjectMembersResponse.parse(
      (await as('bob').get(`/api/v1/projects/${id}/members`)).body,
    ).members;
    expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);
  });
});

describe('soft delete', () => {
  it('hides the project from every member immediately; only owners may delete', async () => {
    const id = await fixtureProject();
    await as('bob').delete(`/api/v1/projects/${id}`).expect(403);
    await as('alice').delete(`/api/v1/projects/${id}`).expect(204);
    for (const who of ['alice', 'bob', 'carol']) {
      await as(who).get(`/api/v1/projects/${id}`).expect(404);
      const list = ProjectListResponse.parse((await as(who).get('/api/v1/projects')).body);
      expect(list.projects.some((p) => p.id === id)).toBe(false);
    }
    await as('alice').delete(`/api/v1/projects/${id}`).expect(404);
    expect((await auditActions(id)).at(-1)).toBe('project.deleted');
  });
});

describe.runIf(REDIS_AVAILABLE)('login rate limiting across replicas (Redis)', () => {
  it('two API instances share one budget', async () => {
    const prefix = `lc:test:shared:${Date.now()}:`;
    const a = await createTestApp(dbUrl, { RATE_LIMIT_KEY_PREFIX: prefix });
    const b = await createTestApp(dbUrl, { RATE_LIMIT_KEY_PREFIX: prefix });
    try {
      const attempt = (target: NestExpressApplication) =>
        request(target.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', WEB_ORIGIN)
          .send({ email: 'shared-limit@example.com', password: 'wrong' });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await attempt(i % 2 ? b : a)).status);
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
