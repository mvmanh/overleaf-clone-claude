import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromBuffer } from 'yauzl';
import {
  HistoryListResponse,
  HistoryVersionDetail,
  type HistoryVersion,
  RestoreVersionResponse,
} from '@latex-cloud/shared';
import { createTestApp, createTestDatabase, loginCookie, WEB_ORIGIN } from './helpers';

let app: NestExpressApplication;
let drop: () => Promise<void>;
const cookies: Record<string, string> = {};
let projectId: string;
let mainId: string;

const as = (who: 'alice' | 'bob' | 'carol') => {
  const agent = request(app.getHttpServer());
  const wrap = (m: 'get' | 'post' | 'put' | 'patch' | 'delete') => (path: string) =>
    agent[m](path).set('Cookie', cookies[who]!).set('Origin', WEB_ORIGIN);
  return {
    get: wrap('get'),
    post: wrap('post'),
    put: wrap('put'),
    patch: wrap('patch'),
    delete: wrap('delete'),
  };
};
const base = () => `/api/v1/projects/${projectId}`;

async function history(query = ''): Promise<HistoryListResponse> {
  const res = await as('alice').get(`${base()}/history${query}`).expect(200);
  return HistoryListResponse.parse(res.body);
}

async function file(id: string) {
  return (await as('alice').get(`${base()}/files/${id}`).expect(200)).body as {
    content: string;
    sha256: string;
    path: string;
  };
}

async function save(id: string, content: string) {
  const { sha256 } = await file(id);
  await as('alice')
    .put(`${base()}/files/${id}/content`)
    .set('If-Match', `"${sha256}"`)
    .send({ content })
    .expect(200);
}

async function zipEntries(buf: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) =>
    fromBuffer(buf, { lazyEntries: true }, (err, z) => {
      if (err || !z) return reject(err);
      const out: Record<string, string> = {};
      z.on('entry', (e: { fileName: string }) => {
        z.openReadStream(e as never, (e2, s) => {
          if (e2 || !s) return reject(e2);
          const chunks: Buffer[] = [];
          s.on('data', (c: Buffer) => chunks.push(c));
          s.on('end', () => {
            out[e.fileName] = Buffer.concat(chunks).toString('utf8');
            z.readEntry();
          });
        });
      });
      z.on('end', () => resolve(out));
      z.readEntry();
    }),
  );
}

async function exportZip(query: string) {
  const res = await as('alice')
    .get(`${base()}/history/export.zip?${query}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  return zipEntries(res.body as Buffer);
}

const of = (vs: HistoryVersion[], fileId: string) => vs.filter((v) => v.fileId === fileId);

beforeAll(async () => {
  const db = await createTestDatabase();
  drop = db.drop;
  app = await createTestApp(db.url);
  for (const who of ['alice', 'bob', 'carol'])
    cookies[who] = await loginCookie(app, `${who}@example.com`);
  const created = await as('alice')
    .post('/api/v1/projects')
    .send({ name: 'History', template: 'article' });
  projectId = created.body.id;
  await as('alice')
    .post(`${base()}/members/invite`)
    .send({ email: 'carol@example.com', role: 'viewer' })
    .expect(201);
  const files = await as('alice').get(`${base()}/files`).expect(200);
  mainId = files.body.files.find((f: { path: string }) => f.path === 'main.tex').id;
});

afterAll(async () => {
  await app?.close();
  await drop?.();
});

describe('version history', () => {
  it('starts with a checkpoint of every template file, credited to the creator', async () => {
    const h = await history();
    expect(h.versions.length).toBeGreaterThan(0);
    const main = of(h.versions, mainId);
    expect(main).toHaveLength(1);
    expect(main[0]).toMatchObject({ source: 'create', path: 'main.tex' });
    expect(main[0]!.authors.map((a) => a.name)).toEqual(['Alice Nguyen']);
  });

  it('checkpoints edits at most once per window; a label captures the latest text', async () => {
    const original = (await file(mainId)).content;
    await save(mainId, `${original}% edit one\n`);
    await save(mainId, `${original}% edit one\n% edit two\n`);
    let main = of((await history()).versions, mainId);
    expect(main.map((v) => v.source)).toEqual(['edit', 'create']);
    // Coalesced: the edit checkpoint holds the first save of the window.
    let d = HistoryVersionDetail.parse(
      (await as('alice').get(`${base()}/history/versions/${main[0]!.id}`).expect(200)).body,
    );
    expect(d.content).toContain('% edit one');
    expect(d.content).not.toContain('% edit two');
    expect(d.previous?.version.source).toBe('create');
    expect(d.previous?.content).toBe(original);

    const label = await as('alice')
      .post(`${base()}/history/labels`)
      .send({ name: 'Submitted to journal' })
      .expect(201);
    expect(label.body).toMatchObject({
      name: 'Submitted to journal',
      createdBy: { name: 'Alice Nguyen' },
    });
    const h = await history();
    expect(h.labels.map((l) => l.name)).toEqual(['Submitted to journal']);
    main = of(h.versions, mainId);
    expect(main).toHaveLength(3);
    d = HistoryVersionDetail.parse(
      (await as('alice').get(`${base()}/history/versions/${main[0]!.id}`).expect(200)).body,
    );
    expect(d.content).toContain('% edit two');

    // The ZIP at the label has exactly that text.
    const zip = await exportZip(`label=${label.body.id}`);
    expect(zip['main.tex']).toContain('% edit two');
  });

  it('restores a live file to an older version as a new checkpoint', async () => {
    const main = of((await history()).versions, mainId);
    const first = main[main.length - 1]!;
    const res = await as('alice')
      .post(`${base()}/history/versions/${first.id}/restore`)
      .expect(200);
    const restored = RestoreVersionResponse.parse(res.body);
    expect(restored).toMatchObject({ samePath: true, file: { id: mainId, path: 'main.tex' } });
    expect((await file(mainId)).content).not.toContain('% edit one');
    const after = of((await history()).versions, mainId);
    expect(after[0]).toMatchObject({ source: 'restore', sha256: first.sha256 });
  });

  it('records renames and deletions, and brings deleted files back', async () => {
    const created = await as('alice')
      .post(`${base()}/files`)
      .send({ path: 'notes.tex', content: 'first notes\n' })
      .expect(201);
    const id = created.body.id as string;
    await as('alice')
      .patch(`${base()}/files/${id}`)
      .send({ path: 'chapters/notes.tex' })
      .expect(200);
    await save(id, 'second notes\n');
    await as('alice').delete(`${base()}/files/${id}`).expect(204);

    const versions = of((await history()).versions, id);
    expect(versions.map((v) => [v.source, v.path])).toEqual([
      ['delete', 'chapters/notes.tex'],
      ['edit', 'chapters/notes.tex'],
      ['rename', 'chapters/notes.tex'],
      ['create', 'notes.tex'],
    ]);
    // The ZIP right after the edit still has the file; the latest state does not.
    expect((await exportZip(`version=${versions[1]!.id}`))['chapters/notes.tex']).toBe(
      'second notes\n',
    );
    expect(await exportZip(`version=${versions[0]!.id}`)).not.toHaveProperty('chapters/notes.tex');

    // Someone created a new file at that path meanwhile: restoring the
    // deletion brings the file back, with its last text, under a new name.
    await as('alice')
      .post(`${base()}/files`)
      .send({ path: 'chapters/notes.tex', content: 'new file\n' })
      .expect(201);
    const back = RestoreVersionResponse.parse(
      (await as('alice').post(`${base()}/history/versions/${versions[0]!.id}/restore`).expect(200))
        .body,
    );
    expect(back).toMatchObject({
      samePath: false,
      file: { id, path: 'chapters/notes-restored.tex' },
    });
    expect((await file(id)).content).toBe('second notes\n');
  });

  it('pages through long histories and filters by file', async () => {
    for (let i = 0; i < 101; i++)
      await as('alice')
        .post(`${base()}/files`)
        .send({ path: `bulk/f${i}.tex`, content: `${i}\n` })
        .expect(201);
    const first = await history();
    expect(first.versions).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    const second = await history(`?before=${first.nextCursor}`);
    const ids = new Set(first.versions.map((v) => v.id));
    expect(second.versions.some((v) => ids.has(v.id))).toBe(false);
    expect(second.labels).toEqual([]);
    const onlyMain = await history(`?file=${mainId}`);
    expect(onlyMain.versions.every((v) => v.fileId === mainId)).toBe(true);
    await as('alice').get(`${base()}/history?before=not-a-cursor`).expect(400);
  });

  it('lets viewers browse but not restore or label; hides projects from outsiders', async () => {
    const h = await as('carol').get(`${base()}/history`).expect(200);
    const v = (h.body as HistoryListResponse).versions[0]!;
    await as('carol').get(`${base()}/history/versions/${v.id}`).expect(200);
    await as('carol').post(`${base()}/history/versions/${v.id}/restore`).expect(403);
    await as('carol').post(`${base()}/history/labels`).send({ name: 'nope' }).expect(403);
    await as('bob').get(`${base()}/history`).expect(404);
    await as('bob').get(`${base()}/history/versions/${v.id}`).expect(404);
  });

  it('removes labels (author or owner only) and validates names', async () => {
    await as('alice').post(`${base()}/history/labels`).send({ name: '   ' }).expect(400);
    const { labels } = await history();
    await as('carol').delete(`${base()}/history/labels/${labels[0]!.id}`).expect(403);
    await as('alice').delete(`${base()}/history/labels/${labels[0]!.id}`).expect(204);
    expect((await history()).labels).toHaveLength(0);
  });
});
