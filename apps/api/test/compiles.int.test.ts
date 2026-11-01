import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from 'pg';
import { Readable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CompileJob,
  COMPILE_WORKER_KEY,
  LatestCompilesResponse,
  ProjectFileListResponse,
} from '@latex-cloud/shared';
import { unpackSnapshot } from '@latex-cloud/compiler-protocol';
import { BLOB_STORAGE, type BlobStorage } from '../src/compiles/blob-storage';
import { COMPILE_QUEUE, type CompileQueue } from '../src/compiles/compile-queue';
import { REDIS } from '../src/health/dependencies';
import { SEED_PROJECTS } from '../src/database/seed-data';
import { createTestApp, createTestDatabase, loginCookie, WEB_ORIGIN } from './helpers';

/* In-memory stand-ins for the queue, object storage and worker heartbeat. */
const blobs = new Map<string, Buffer>();
const enqueued: string[] = [];
let workerOnline = true;
const TEX_IMAGE = 'latex-cloud/texlive@sha256:' + 'a'.repeat(64);

const fakeStorage: BlobStorage = {
  put: async (k, b) => void blobs.set(k, Buffer.from(b)),
  exists: async (k) => blobs.has(k),
  getStream: async (k) => {
    const b = blobs.get(k);
    if (!b) throw new Error('missing');
    return { stream: Readable.from(b), size: b.byteLength };
  },
};
const fakeQueue: CompileQueue = { enqueue: async (id) => void enqueued.push(id) };
const fakeRedis = {
  status: 'ready',
  get: async (k: string) =>
    k === COMPILE_WORKER_KEY && workerOnline
      ? JSON.stringify({
          texImage: TEX_IMAGE,
          executor: 'docker',
          isolation: 'container',
          concurrency: 1,
          updatedAt: new Date().toISOString(),
        })
      : null,
  eval: async () => 1,
  del: async () => 1,
  ping: async () => 'PONG',
  on: () => undefined,
  disconnect: () => undefined,
};

let app: NestExpressApplication;
let dbUrl: string;
let drop: () => Promise<void>;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  const db = await createTestDatabase();
  dbUrl = db.url;
  drop = db.drop;
  app = await createTestApp(db.url, {}, (b) =>
    b
      .overrideProvider(BLOB_STORAGE)
      .useValue(fakeStorage)
      .overrideProvider(COMPILE_QUEUE)
      .useValue(fakeQueue)
      .overrideProvider(REDIS)
      .useValue(fakeRedis),
  );
  for (const n of ['alice', 'bob', 'carol'])
    cookies[n] = await loginCookie(app, `${n}@example.com`);
});

afterAll(async () => {
  await app?.close();
  await drop?.();
});

beforeEach(() => {
  workerOnline = true;
});

const as = (who: string) => {
  const s = app.getHttpServer();
  const c = cookies[who] ?? '';
  return {
    get: (u: string) => request(s).get(u).set('Cookie', c),
    post: (u: string) => request(s).post(u).set('Origin', WEB_ORIGIN).set('Cookie', c),
    put: (u: string) => request(s).put(u).set('Origin', WEB_ORIGIN).set('Cookie', c),
  };
};

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}

async function newProject(): Promise<string> {
  const res = await as('alice')
    .post('/api/v1/projects')
    .send({ name: 'Compile me', template: 'cs' })
    .expect(201);
  await as('alice')
    .post(`/api/v1/projects/${res.body.id}/members/invite`)
    .send({ email: 'carol@example.com', role: 'viewer' })
    .expect(201);
  return res.body.id;
}

async function editMain(projectId: string, content: string) {
  const list = ProjectFileListResponse.parse(
    (await as('alice').get(`/api/v1/projects/${projectId}/files`)).body,
  );
  const main = list.files.find((f) => f.path === 'main.tex')!;
  await as('alice')
    .put(`/api/v1/projects/${projectId}/files/${main.id}/content`)
    .set('If-Match', main.sha256)
    .send({ content })
    .expect(200);
}

describe('requesting a compile', () => {
  it('captures an immutable revision, stores the snapshot and queues one job', async () => {
    const id = await newProject();
    const res = await as('alice').post(`/api/v1/projects/${id}/compiles`).expect(202);
    const job = CompileJob.parse(res.body);
    expect(job).toMatchObject({
      status: 'queued',
      engine: 'pdflatex',
      rootFile: 'main.tex',
      cacheHit: false,
    });
    expect(enqueued).toContain(job.id);

    const [rev] = await sql<{
      source_key: string;
      manifest: { texImage: string; files: { path: string }[] };
    }>('select source_key, manifest from project_revisions where id = $1', [job.revisionId]);
    expect(rev!.source_key).toBe(`sources/${id}/${job.fingerprint}.tar`);
    expect(rev!.manifest.texImage).toBe(TEX_IMAGE);
    const files = await unpackSnapshot(blobs.get(rev!.source_key)!, {
      maxFiles: 100,
      maxTotalBytes: 1e7,
    });
    expect(files.map((f) => f.path)).toEqual(['main.tex', 'references.bib']);
  });

  it('coalesces repeated clicks on unchanged content into the same job', async () => {
    const id = await newProject();
    const before = enqueued.length;
    const results = await Promise.all(
      [1, 2, 3].map(() => as('alice').post(`/api/v1/projects/${id}/compiles`)),
    );
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    expect(enqueued.length - before).toBe(1);
  });

  it('latest wins: a new revision supersedes the queued older one', async () => {
    const id = await newProject();
    const first = (await as('alice').post(`/api/v1/projects/${id}/compiles`).expect(202)).body;
    await editMain(id, '\\documentclass{article}\\begin{document}v2\\end{document}');
    const second = (await as('alice').post(`/api/v1/projects/${id}/compiles`).expect(202)).body;
    expect(second.fingerprint).not.toBe(first.fingerprint);
    const old = CompileJob.parse((await as('alice').get(`/api/v1/compiles/${first.id}`)).body);
    expect(old.status).toBe('superseded');
    const latest = LatestCompilesResponse.parse(
      (await as('alice').get(`/api/v1/projects/${id}/compiles/latest`)).body,
    );
    expect(latest.latest?.id).toBe(second.id);
    expect(latest.lastSuccessful).toBeNull();
  });

  it('returns a cache hit for content that already built successfully', async () => {
    const id = await newProject();
    const job = (await as('alice').post(`/api/v1/projects/${id}/compiles`).expect(202)).body;
    await sql(
      `update compile_jobs set status='succeeded', outcome='succeeded', finished_at=now() where id=$1`,
      [job.id],
    );
    const again = CompileJob.parse(
      (await as('alice').post(`/api/v1/projects/${id}/compiles`).expect(202)).body,
    );
    expect(again).toMatchObject({ id: job.id, cacheHit: true, status: 'succeeded' });
    const latest = LatestCompilesResponse.parse(
      (await as('alice').get(`/api/v1/projects/${id}/compiles/latest`)).body,
    );
    expect(latest.lastSuccessful?.id).toBe(job.id);
  });

  it('retries after sandbox errors but reuses deterministic compile errors', async () => {
    const id = await newProject();
    const a = (await as('alice').post(`/api/v1/projects/${id}/compiles`)).body;
    await sql(
      `update compile_jobs set status='failed', outcome='sandbox-error', finished_at=now() where id=$1`,
      [a.id],
    );
    const b = (await as('alice').post(`/api/v1/projects/${id}/compiles`)).body;
    expect(b.id).not.toBe(a.id);
    await sql(
      `update compile_jobs set status='failed', outcome='compile-error', finished_at=now() where id=$1`,
      [b.id],
    );
    const c = (await as('alice').post(`/api/v1/projects/${id}/compiles`)).body;
    expect(c.id).toBe(b.id);
  });

  it('503 with a clear message when no worker is running', async () => {
    const id = await newProject();
    workerOnline = false;
    const res = await as('alice').post(`/api/v1/projects/${id}/compiles`).expect(503);
    expect(res.body.error.code).toBe('COMPILER_UNAVAILABLE');
  });

  it('requires a main file', async () => {
    const id = await newProject();
    await sql(`update projects set root_file_path = null where id = $1`, [id]);
    await as('alice').post(`/api/v1/projects/${id}/compiles`).expect(400);
  });
});

describe('authorization', () => {
  it('viewers can compile and read results; outsiders get 404 for jobs and artifacts', async () => {
    const id = await newProject();
    const job = (await as('carol').post(`/api/v1/projects/${id}/compiles`).expect(202)).body;
    await as('carol').get(`/api/v1/compiles/${job.id}`).expect(200);
    await as('bob').get(`/api/v1/compiles/${job.id}`).expect(404);
    await as('bob').get(`/api/v1/compiles/${job.id}/artifacts/pdf`).expect(404);
    await as('bob').get(`/api/v1/projects/${id}/compiles/latest`).expect(404);
    await as('bob').post(`/api/v1/projects/${id}/compiles`).expect(404);
    const other = SEED_PROJECTS.find((p) => p.owner === 'carol@example.com')!.id;
    await as('alice').post(`/api/v1/projects/${other}/compiles`).expect(404);
    await as('alice').get('/api/v1/compiles/not-a-uuid').expect(404);
  });

  it('streams artifacts with safe headers to members', async () => {
    const id = await newProject();
    const job = (await as('alice').post(`/api/v1/projects/${id}/compiles`)).body;
    const key = `artifacts/${id}/${job.id}/main.pdf`;
    blobs.set(key, Buffer.from('%PDF-1.5 fake'));
    await sql(
      `insert into compile_artifacts (compile_job_id, kind, file_name, blob_key, size_bytes, sha256) values ($1,'pdf','main.pdf',$2,13,'x')`,
      [job.id, key],
    );
    const res = await as('carol')
      .get(`/api/v1/compiles/${job.id}/artifacts/pdf`)
      .buffer(true)
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.body).toString()).toBe('%PDF-1.5 fake');
    await as('carol').get(`/api/v1/compiles/${job.id}/artifacts/exe`).expect(404);
    await as('carol').get(`/api/v1/compiles/${job.id}/artifacts/log`).expect(404);
  });
});
