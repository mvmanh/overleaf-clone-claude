import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_TEXT_FILE_BYTES,
  ProjectFile,
  ProjectFileListResponse,
  ProjectFileWithContent,
  ProjectSummary,
} from '@latex-cloud/shared';
import { SEED_PROJECTS } from '../src/database/seed-data';
import { createTestApp, createTestDatabase, loginCookie, WEB_ORIGIN } from './helpers';

let app: NestExpressApplication;
let drop: () => Promise<void>;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  const db = await createTestDatabase();
  drop = db.drop;
  app = await createTestApp(db.url);
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
    put: (u: string) => request(s).put(u).set('Origin', WEB_ORIGIN).set('Cookie', c),
    patch: (u: string) => request(s).patch(u).set('Origin', WEB_ORIGIN).set('Cookie', c),
    delete: (u: string) => request(s).delete(u).set('Origin', WEB_ORIGIN).set('Cookie', c),
  };
};

/** Alice-owned project with bob as editor, carol as viewer. */
async function project(template = 'article'): Promise<string> {
  const res = await as('alice')
    .post('/api/v1/projects')
    .send({ name: 'Files', template })
    .expect(201);
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

const files = async (who: string, id: string) =>
  ProjectFileListResponse.parse(
    (await as(who).get(`/api/v1/projects/${id}/files`).expect(200)).body,
  );

describe('templates', () => {
  it('new projects start with a compilable main.tex as the root file', async () => {
    const id = await project('cs');
    const list = await files('alice', id);
    expect(list.rootFile).toBe('main.tex');
    expect(list.files.map((f) => f.path)).toEqual(['main.tex', 'references.bib']);
    const main = ProjectFileWithContent.parse(
      (await as('carol').get(`/api/v1/projects/${id}/files/${list.files[0]!.id}`).expect(200)).body,
    );
    expect(main.content).toContain('\\documentclass');
  });

  it('seeded projects have files', async () => {
    const list = await files('alice', SEED_PROJECTS[0]!.id);
    expect(list.files.some((f) => f.path === 'main.tex')).toBe(true);
  });
});

describe('create / read', () => {
  it('editors create text files; viewers and outsiders cannot', async () => {
    const id = await project();
    const res = await as('bob')
      .post(`/api/v1/projects/${id}/files`)
      .send({ path: 'chapters/intro.tex', content: 'Hello' })
      .expect(201);
    const f = ProjectFile.parse(res.body);
    expect(f).toMatchObject({ path: 'chapters/intro.tex', kind: 'text', sizeBytes: 5 });
    await as('carol').post(`/api/v1/projects/${id}/files`).send({ path: 'x.tex' }).expect(403);
    const outsider = SEED_PROJECTS.find((p) => p.owner === 'carol@example.com')!.id;
    await as('alice').get(`/api/v1/projects/${outsider}/files`).expect(404);
    await as('alice')
      .post(`/api/v1/projects/${outsider}/files`)
      .send({ path: 'x.tex' })
      .expect(404);
  });

  it.each([
    '../escape.tex',
    '/abs.tex',
    'latexmkrc',
    '.latexmkrc',
    'a//b.tex',
    'pic.png',
    '-opt.tex',
  ])('rejects unsafe or non-text path %s', async (path) => {
    const id = await project('blank');
    const res = await as('alice').post(`/api/v1/projects/${id}/files`).send({ path }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects case-insensitive duplicates but allows re-creating a deleted path', async () => {
    const id = await project('blank');
    const a = await as('alice')
      .post(`/api/v1/projects/${id}/files`)
      .send({ path: 'notes.tex' })
      .expect(201);
    await as('alice').post(`/api/v1/projects/${id}/files`).send({ path: 'NOTES.tex' }).expect(409);
    await as('alice').delete(`/api/v1/projects/${id}/files/${a.body.id}`).expect(204);
    await as('alice').post(`/api/v1/projects/${id}/files`).send({ path: 'notes.tex' }).expect(201);
  });

  it('returns 404 for files of another project even with a valid file id', async () => {
    const mine = await project('blank');
    const other = SEED_PROJECTS.find((p) => p.owner === 'carol@example.com')!.id;
    const carolsFile = (await files('carol', other)).files[0]!;
    await as('alice').get(`/api/v1/projects/${mine}/files/${carolsFile.id}`).expect(404);
  });
});

describe('save (optimistic concurrency)', () => {
  it('requires If-Match, saves with the current hash, and rejects stale writes with 412', async () => {
    const id = await project();
    const main = (await files('alice', id)).files.find((f) => f.path === 'main.tex')!;
    const url = `/api/v1/projects/${id}/files/${main.id}/content`;

    await as('alice').put(url).send({ content: 'x' }).expect(428);

    const saved = await as('alice')
      .put(url)
      .set('If-Match', `"${main.sha256}"`)
      .send({ content: 'v2' })
      .expect(200);
    expect(saved.headers.etag).toBe(`"${saved.body.sha256}"`);

    // Bob still holds the original version: his write must not clobber Alice's.
    const stale = await as('bob')
      .put(url)
      .set('If-Match', main.sha256)
      .send({ content: 'bob' })
      .expect(412);
    expect(stale.body.error.code).toBe('PRECONDITION_FAILED');

    const now = ProjectFileWithContent.parse(
      (await as('bob').get(`/api/v1/projects/${id}/files/${main.id}`)).body,
    );
    expect(now.content).toBe('v2');
    await as('bob').put(url).set('If-Match', now.sha256).send({ content: 'v3 by bob' }).expect(200);
  });

  it('is idempotent for retried identical saves', async () => {
    const id = await project('blank');
    const main = (await files('alice', id)).files[0]!;
    const url = `/api/v1/projects/${id}/files/${main.id}/content`;
    const first = await as('alice')
      .put(url)
      .set('If-Match', main.sha256)
      .send({ content: 'same' })
      .expect(200);
    await as('alice').put(url).set('If-Match', main.sha256).send({ content: 'same' }).expect(200);
    expect(first.body.sha256).toBeTruthy();
  });

  it('viewers cannot save; oversize content is rejected', async () => {
    const id = await project('blank');
    const main = (await files('alice', id)).files[0]!;
    const url = `/api/v1/projects/${id}/files/${main.id}/content`;
    await as('carol').put(url).set('If-Match', main.sha256).send({ content: 'nope' }).expect(403);
    await as('alice')
      .put(url)
      .set('If-Match', main.sha256)
      .send({ content: 'a'.repeat(MAX_TEXT_FILE_BYTES + 1) })
      .expect(400);
  });
});

describe('rename / delete / root file', () => {
  it('renaming the root file keeps it the root; root must stay .tex', async () => {
    const id = await project('cs');
    const list = await files('alice', id);
    const main = list.files.find((f) => f.path === 'main.tex')!;
    await as('bob')
      .patch(`/api/v1/projects/${id}/files/${main.id}`)
      .send({ path: 'paper.tex' })
      .expect(200);
    expect((await files('alice', id)).rootFile).toBe('paper.tex');
    await as('bob')
      .patch(`/api/v1/projects/${id}/files/${main.id}`)
      .send({ path: 'paper.bib' })
      .expect(400);
    await as('bob')
      .patch(`/api/v1/projects/${id}/files/${main.id}`)
      .send({ path: 'paper.png' })
      .expect(400);
    const bib = list.files.find((f) => f.path === 'references.bib')!;
    await as('bob')
      .patch(`/api/v1/projects/${id}/files/${bib.id}`)
      .send({ path: 'paper.tex' })
      .expect(409); // taken
    await as('bob')
      .patch(`/api/v1/projects/${id}/files/${bib.id}`)
      .send({ path: 'PAPER.bib' })
      .expect(200);
    await as('carol')
      .patch(`/api/v1/projects/${id}/files/${bib.id}`)
      .send({ path: 'x.bib' })
      .expect(403);
  });

  it('cannot delete the root file until another is chosen', async () => {
    const id = await project();
    const main = (await files('alice', id)).files[0]!;
    await as('alice').delete(`/api/v1/projects/${id}/files/${main.id}`).expect(409);
    await as('alice').post(`/api/v1/projects/${id}/files`).send({ path: 'other.tex' }).expect(201);
    await as('alice').patch(`/api/v1/projects/${id}`).send({ rootFile: 'refs.bib' }).expect(400);
    await as('alice').patch(`/api/v1/projects/${id}`).send({ rootFile: 'missing.tex' }).expect(400);
    const p = await as('bob')
      .patch(`/api/v1/projects/${id}`)
      .send({ rootFile: 'other.tex' })
      .expect(200);
    expect(p.body.rootFile).toBe('other.tex');
    await as('alice').delete(`/api/v1/projects/${id}/files/${main.id}`).expect(204);
    expect((await files('carol', id)).files.map((f) => f.path)).toEqual(['other.tex']);
    await as('alice').get(`/api/v1/projects/${id}/files/${main.id}`).expect(404);
  });

  it('files of a soft-deleted project are inaccessible', async () => {
    const id = await project('blank');
    const main = (await files('alice', id)).files[0]!;
    await as('alice').delete(`/api/v1/projects/${id}`).expect(204);
    await as('alice').get(`/api/v1/projects/${id}/files`).expect(404);
    await as('alice').get(`/api/v1/projects/${id}/files/${main.id}`).expect(404);
  });
});

describe('text contents (editor index)', () => {
  it('returns every text file with content to members only', async () => {
    const id = await project('cs');
    const res = await as('carol').get(`/api/v1/projects/${id}/files/contents`).expect(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.files.map((f: { path: string }) => f.path)).toEqual([
      'main.tex',
      'references.bib',
    ]);
    expect(res.body.files[1].content).toContain('@book{knuth1998');
    const outsider = SEED_PROJECTS.find((p) => p.owner === 'carol@example.com')!.id;
    await as('alice').get(`/api/v1/projects/${outsider}/files/contents`).expect(404);
  });
});
