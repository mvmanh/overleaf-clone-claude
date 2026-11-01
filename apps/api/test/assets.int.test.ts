import type { NestExpressApplication } from '@nestjs/platform-express';
import { Readable } from 'node:stream';
import request from 'supertest';
import { fromBuffer } from 'yauzl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COMPILE_WORKER_KEY,
  ImportProjectResponse,
  ProjectFileListResponse,
  UploadFileResponse,
} from '@latex-cloud/shared';
import { unpackSnapshot } from '@latex-cloud/compiler-protocol';
import { COMPILE_QUEUE } from '../src/compiles/compile-queue';
import { REDIS } from '../src/health/dependencies';
import { BLOB_STORAGE, type BlobStorage } from '../src/storage/blob-storage';
import { createTestApp, createTestDatabase, loginCookie, WEB_ORIGIN } from './helpers';
import { makeZip, PNG_1PX } from './zip-utils';

const blobs = new Map<string, Buffer>();
const storage: BlobStorage = {
  put: async (k, b) => void blobs.set(k, Buffer.from(b)),
  exists: async (k) => blobs.has(k),
  get: async (k) => {
    const b = blobs.get(k);
    if (!b) throw new Error('missing ' + k);
    return b;
  },
  getStream: async (k) => ({
    stream: Readable.from(blobs.get(k)!),
    size: blobs.get(k)!.byteLength,
  }),
};
const redis = {
  status: 'ready',
  get: async (k: string) =>
    k === COMPILE_WORKER_KEY
      ? JSON.stringify({
          texImage: 'img@sha256:' + 'b'.repeat(64),
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
let drop: () => Promise<void>;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  const db = await createTestDatabase();
  drop = db.drop;
  app = await createTestApp(db.url, {}, (b) =>
    b
      .overrideProvider(BLOB_STORAGE)
      .useValue(storage)
      .overrideProvider(REDIS)
      .useValue(redis)
      .overrideProvider(COMPILE_QUEUE)
      .useValue({ enqueue: async () => undefined }),
  );
  for (const n of ['alice', 'bob', 'carol'])
    cookies[n] = await loginCookie(app, `${n}@example.com`);
});

afterAll(async () => {
  await app?.close();
  await drop?.();
});

const as = (who: string) => {
  const s = app.getHttpServer();
  const c = cookies[who] ?? '';
  return {
    get: (u: string) => request(s).get(u).set('Cookie', c),
    post: (u: string) => request(s).post(u).set('Origin', WEB_ORIGIN).set('Cookie', c),
    patch: (u: string) => request(s).patch(u).set('Origin', WEB_ORIGIN).set('Cookie', c),
  };
};

async function project(): Promise<string> {
  const res = await as('alice')
    .post('/api/v1/projects')
    .send({ name: 'Assets', template: 'article' })
    .expect(201);
  await as('alice')
    .post(`/api/v1/projects/${res.body.id}/members/invite`)
    .send({ email: 'carol@example.com', role: 'viewer' })
    .expect(201);
  return res.body.id;
}

const upload = (who: string, id: string, data: Buffer, path: string, overwrite?: boolean) => {
  const r = as(who).post(`/api/v1/projects/${id}/files/upload`).field('path', path);
  if (overwrite) r.field('overwrite', 'true');
  return r.attach('file', data, path.split('/').pop()!);
};

describe('upload', () => {
  it('stores verified binaries content-addressed per project; editors only', async () => {
    const id = await project();
    const res = await upload('alice', id, PNG_1PX, 'figures/dot.png').expect(201);
    const { file, replaced } = UploadFileResponse.parse(res.body);
    expect(file).toMatchObject({
      path: 'figures/dot.png',
      kind: 'binary',
      sizeBytes: PNG_1PX.byteLength,
    });
    expect(replaced).toBe(false);
    expect(blobs.has(`files/${id}/${file.sha256}`)).toBe(true);
    await upload('carol', id, PNG_1PX, 'x.png').expect(403);
    await upload('bob', id, PNG_1PX, 'x.png').expect(404);
  });

  it('rejects spoofed, unsupported, unsafe and invalid-UTF-8 files', async () => {
    const id = await project();
    expect(
      (await upload('alice', id, Buffer.from('#!/bin/sh\nid'), 'evil.png').expect(400)).body.error
        .message,
    ).toMatch(/does not look like/);
    await upload('alice', id, Buffer.from('MZ'), 'tool.exe').expect(400);
    await upload('alice', id, PNG_1PX, '../escape.png').expect(400);
    await upload('alice', id, PNG_1PX, '__lc_cache__/x.png').expect(400);
    await upload('alice', id, Buffer.from([0xff, 0xfe, 0x41]), 'latin1.tex').expect(400);
    await upload('alice', id, Buffer.alloc(2 * 1024 * 1024 + 1, 0x61), 'huge.tex').expect(413);
  });

  it('conflicts on existing paths unless overwrite is requested; uploads text as editable text', async () => {
    const id = await project();
    await upload('alice', id, Buffer.from('% chapter'), 'chap.tex').expect(201);
    await upload('alice', id, Buffer.from('% v2'), 'CHAP.tex').expect(409);
    const r = await upload('alice', id, Buffer.from('\uFEFF% v2'), 'chap.tex', true).expect(201);
    expect(r.body.replaced).toBe(true);
    const list = ProjectFileListResponse.parse(
      (await as('alice').get(`/api/v1/projects/${id}/files`)).body,
    );
    const chap = list.files.find((f) => f.path === 'chap.tex')!;
    expect(chap.kind).toBe('text');
    expect((await as('alice').get(`/api/v1/projects/${id}/files/${chap.id}`)).body.content).toBe(
      '% v2',
    );
  });

  it('serves raw bytes with safe headers; binaries cannot change type on rename', async () => {
    const id = await project();
    const { file } = (await upload('alice', id, PNG_1PX, 'dot.png').expect(201)).body;
    const raw = await as('carol')
      .get(`/api/v1/projects/${id}/files/${file.id}/raw`)
      .buffer(true)
      .expect(200);
    expect(raw.headers['content-type']).toBe('image/png');
    expect(raw.headers['content-disposition']).toMatch(/^inline;/);
    expect(raw.headers['content-security-policy']).toContain('sandbox');
    expect(raw.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(raw.body as Buffer, PNG_1PX)).toBe(0);
    await as('bob').get(`/api/v1/projects/${id}/files/${file.id}/raw`).expect(404);
    await as('alice')
      .patch(`/api/v1/projects/${id}/files/${file.id}`)
      .send({ path: 'dot.jpg' })
      .expect(400);
    await as('alice')
      .patch(`/api/v1/projects/${id}/files/${file.id}`)
      .send({ path: 'img/dot.png' })
      .expect(200);
  });

  it('compile snapshots include binary files byte-for-byte', async () => {
    const id = await project();
    await upload('alice', id, PNG_1PX, 'figures/dot.png').expect(201);
    const job = (await as('alice').post(`/api/v1/projects/${id}/compiles`).expect(202)).body;
    const tar = blobs.get(`sources/${id}/${job.fingerprint}.tar`)!;
    const files = await unpackSnapshot(tar, { maxFiles: 100, maxTotalBytes: 1e7 });
    const png = files.find((f) => f.path === 'figures/dot.png')!;
    expect(Buffer.compare(Buffer.from(png.content), PNG_1PX)).toBe(0);
  });
});

describe('ZIP import / export', () => {
  const doc =
    '\\documentclass{article}\n\\usepackage{fontspec}\n\\begin{document}\\includegraphics{fig/a.png}\\end{document}';

  it('imports an Overleaf-style ZIP, detects root and engine, reports skipped entries', async () => {
    const zip = makeZip([
      { name: 'thesis/main.tex', data: Buffer.from(doc) },
      { name: 'thesis/fig/a.png', data: PNG_1PX },
      { name: 'thesis/refs.bib', data: Buffer.from('@misc{a,}') },
      { name: 'thesis/main.aux', data: Buffer.from('\\relax') },
      { name: 'thesis/run.sh', data: Buffer.from('id') },
      { name: 'thesis/fake.png', data: Buffer.from('not png') },
    ]);
    const res = await as('bob')
      .post('/api/v1/projects/import')
      .attach('file', zip, 'Luận văn.zip')
      .expect(201);
    const body = ImportProjectResponse.parse(res.body);
    expect(body.project).toMatchObject({
      name: 'Luận văn',
      engine: 'xelatex',
      rootFile: 'main.tex',
      role: 'owner',
    });
    expect(body.importedFiles).toBe(3);
    expect(body.skipped.map((s) => s.path).sort()).toEqual(['fake.png', 'main.aux', 'run.sh']);
    await as('alice').get(`/api/v1/projects/${body.project.id}`).expect(404);

    // Export round-trips the same files.
    const exp = await as('bob')
      .get(`/api/v1/projects/${body.project.id}/export.zip`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(exp.headers['content-type']).toBe('application/zip');
    expect(exp.headers['content-disposition']).toContain(
      "filename*=UTF-8''Lu%E1%BA%ADn%20v%C4%83n.zip",
    );
    const names = await new Promise<string[]>((resolve, reject) =>
      fromBuffer(exp.body as Buffer, { lazyEntries: false }, (err, z) => {
        if (err || !z) return reject(err);
        const n: string[] = [];
        z.on('entry', (e: { fileName: string }) => n.push(e.fileName));
        z.on('end', () => resolve(n.sort()));
      }),
    );
    expect(names).toEqual(['fig/a.png', 'main.tex', 'refs.bib']);
    await as('alice').get(`/api/v1/projects/${body.project.id}/export.zip`).expect(404);
  });

  it('rejects hostile or useless archives with a clear message', async () => {
    const bomb = makeZip([
      { name: 'b.tex', data: Buffer.alloc(8 * 1024 * 1024, 0x20), deflate: true },
    ]);
    expect(
      (await as('alice').post('/api/v1/projects/import').attach('file', bomb, 'b.zip').expect(400))
        .body.error.message,
    ).toMatch(/bomb/);
    const trav = makeZip([{ name: '../../x.tex', data: Buffer.from(doc) }]);
    await as('alice').post('/api/v1/projects/import').attach('file', trav, 't.zip').expect(400);
    await as('alice')
      .post('/api/v1/projects/import')
      .attach('file', Buffer.from('nope'), 'n.zip')
      .expect(400);
    const empty = makeZip([{ name: 'tool.exe', data: Buffer.from('MZ') }]);
    expect(
      (await as('alice').post('/api/v1/projects/import').attach('file', empty, 'e.zip').expect(400))
        .body.error.message,
    ).toMatch(/no supported files/);
    await as('alice').post('/api/v1/projects/import').expect(400);
  });
});
