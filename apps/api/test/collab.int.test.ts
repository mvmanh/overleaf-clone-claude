import type { NestExpressApplication } from '@nestjs/platform-express';
import { HocuspocusProvider } from '@hocuspocus/provider';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mintCollabToken } from '@latex-cloud/collab-protocol';
import {
  CollabTokenResponse,
  fileDocName,
  parseCollabNotice,
  projectRoomName,
  type CollabNotice,
} from '@latex-cloud/shared';
// The collab server is a separate app; the test drives both against one database.
import { type CollabServer, createCollabServer, loadCollabConfig } from '../../collab/src/index';
import { createDb } from '../src/database/connection';
import {
  createTestApp,
  createTestDatabase,
  loginCookie,
  REDIS_AVAILABLE,
  WEB_ORIGIN,
} from './helpers';

const SECRET = 'integration-collab-secret-0123456789abcdef';

let dbUrl: string;
let drop: () => Promise<void>;
let app: NestExpressApplication;
let collab: CollabServer;
let wsUrl: string;
const cookies: Record<'alice' | 'bob' | 'carol', string> = { alice: '', bob: '', carol: '' };
const ids: Record<'alice' | 'bob' | 'carol', string> = { alice: '', bob: '', carol: '' };
let projectId: string;
let mainId: string;
const open: HocuspocusProvider[] = [];

const http = () => request(app.getHttpServer());
const api = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  who: keyof typeof cookies,
) => http()[method](`/api/v1${path}`).set('Cookie', cookies[who]).set('Origin', WEB_ORIGIN);

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 5_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function startCollab(overrides: Record<string, string> = {}): CollabServer {
  return createCollabServer(
    loadCollabConfig({
      NODE_ENV: 'test',
      COLLAB_PORT: '0',
      COLLAB_HOST: '127.0.0.1',
      DATABASE_URL: dbUrl,
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:1',
      COLLAB_TOKEN_SECRET: SECRET,
      WEB_ORIGIN,
      // Long debounce: proves durability does not depend on compaction.
      COLLAB_STORE_DEBOUNCE_MS: '60000',
      COLLAB_STORE_MAX_DEBOUNCE_MS: '120000',
      ...overrides,
    }),
    { redis: REDIS_AVAILABLE ? undefined : null },
  );
}

async function token(who: keyof typeof cookies, pid = projectId): Promise<string> {
  const res = await api('post', `/projects/${pid}/collab/token`, who);
  expect(res.status).toBe(200);
  return CollabTokenResponse.parse(res.body).token;
}

interface Client {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  text: Y.Text;
  notices: CollabNotice[];
  failed: string | null;
}

function connect(name: string, tokenValue: string, opts: { wait?: boolean } = {}): Promise<Client> {
  const doc = new Y.Doc();
  const client: Client = {
    provider: null!,
    doc,
    text: doc.getText('content'),
    notices: [],
    failed: null,
  };
  return new Promise((resolve, reject) => {
    client.provider = new HocuspocusProvider({
      url: wsUrl,
      name,
      document: doc,
      token: tokenValue,
      onStateless: ({ payload }) => {
        const n = parseCollabNotice(payload);
        if (n) client.notices.push(n);
      },
      onAuthenticationFailed: ({ reason }) => {
        client.failed = reason;
        if (opts.wait !== false) reject(new Error(`auth failed: ${reason}`));
        else resolve(client);
      },
      onSynced: () => resolve(client),
    });
    open.push(client.provider);
  });
}

const settled = (c: Client) => until(() => !c.provider.hasUnsyncedChanges, 'acknowledged edits');

async function fileText(fileId: string, who: keyof typeof cookies = 'alice') {
  const res = await api('get', `/projects/${projectId}/files/${fileId}`, who);
  return res.body as { content: string; sha256: string };
}

beforeAll(async () => {
  ({ url: dbUrl, drop } = await createTestDatabase());
  app = await createTestApp(dbUrl, { COLLAB_TOKEN_SECRET: SECRET });
  for (const who of ['alice', 'bob', 'carol'] as const) {
    cookies[who] = await loginCookie(app, `${who}@example.com`);
    ids[who] = (await api('get', '/auth/me', who)).body.user.id;
  }
  const created = await api('post', '/projects', 'alice').send({
    name: 'Collab test',
    template: 'article',
  });
  projectId = created.body.id;
  await api('post', `/projects/${projectId}/members/invite`, 'alice').send({
    email: 'bob@example.com',
    role: 'editor',
  });
  await api('post', `/projects/${projectId}/members/invite`, 'alice').send({
    email: 'carol@example.com',
    role: 'viewer',
  });
  const files = await api('get', `/projects/${projectId}/files`, 'alice');
  mainId = files.body.files.find((f: { path: string }) => f.path === 'main.tex').id;
  collab = startCollab();
  const { port } = await collab.listen();
  wsUrl = `ws://127.0.0.1:${port}/collab`;
});

afterAll(async () => {
  for (const p of open) p.destroy();
  await collab?.close();
  await app?.close();
  await drop?.();
});

describe('collab token', () => {
  it('is minted for members with the collab URL, role and identity', async () => {
    const res = await api('post', `/projects/${projectId}/collab/token`, 'carol');
    expect(res.status).toBe(200);
    const body = CollabTokenResponse.parse(res.body);
    expect(body.role).toBe('viewer');
    expect(body.user).toMatchObject({ id: ids.carol, name: 'Carol Le' });
    expect(body.url).toMatch(/^wss?:\/\/|^\//);
  });

  it('is refused to non-members (404) and without a session (401)', async () => {
    const other = await api('post', '/projects', 'bob').send({
      name: 'Private',
      template: 'blank',
    });
    expect((await api('post', `/projects/${other.body.id}/collab/token`, 'carol')).status).toBe(
      404,
    );
    expect(
      (await http().post(`/api/v1/projects/${projectId}/collab/token`).set('Origin', WEB_ORIGIN))
        .status,
    ).toBe(401);
  });
});

describe('connection authorization', () => {
  it('rejects a forged, expired, foreign-project or non-member token', async () => {
    const name = fileDocName(projectId, mainId);
    const forged = mintCollabToken('f'.repeat(40), { userId: ids.alice, projectId }).token;
    const expired = mintCollabToken(
      SECRET,
      { userId: ids.alice, projectId },
      { ttlSeconds: -120 },
    ).token;
    const foreign = await token(
      'bob',
      (await api('post', '/projects', 'bob').send({ name: 'X', template: 'blank' })).body.id,
    );
    const stranger = mintCollabToken(SECRET, {
      userId: '00000000-0000-4000-8000-000000000000',
      projectId,
    }).token;
    for (const t of [forged, expired, foreign, stranger, 'garbage']) {
      const c = await connect(name, t, { wait: false });
      expect(c.failed, t.slice(0, 12)).not.toBeNull();
    }
  });

  it('rejects unknown document names and files of other projects', async () => {
    const t = await token('alice');
    const c1 = await connect('../../etc/passwd', t, { wait: false });
    expect(c1.failed).not.toBeNull();
    const other = await api('post', '/projects', 'alice').send({
      name: 'Other',
      template: 'article',
    });
    const otherFiles = await api('get', `/projects/${other.body.id}/files`, 'alice');
    const c2 = await connect(fileDocName(projectId, otherFiles.body.files[0].id), t, {
      wait: false,
    });
    expect(c2.failed).not.toBeNull();
  });
});

describe('editing together', () => {
  it('seeds from the stored text and converges concurrent edits without losing text', async () => {
    const original = (await fileText(mainId)).content;
    const name = fileDocName(projectId, mainId);
    const a = await connect(name, await token('alice'));
    const b = await connect(name, await token('bob'));
    expect(a.text.toString()).toBe(original);
    expect(b.text.toString()).toBe(original);

    // Simultaneous edits at both ends.
    a.text.insert(0, '% alice was here\n');
    b.text.insert(b.text.length, '% bob was here\n');
    await until(
      () => a.text.toString() === b.text.toString() && a.text.length > original.length + 20,
      'convergence',
    );
    expect(a.text.toString()).toBe(`% alice was here\n${original}% bob was here\n`);

    // Acknowledged = durable: the API sees it before any compaction ran.
    await settled(a);
    await settled(b);
    expect((await fileText(mainId)).content).toBe(a.text.toString());
    const db = createDb(dbUrl, 1);
    const pending = await db.selectFrom('collab_updates').select('id').execute();
    await db.destroy();
    expect(pending.length).toBeGreaterThan(0);

    // Autocomplete index and ZIP export read the live text too.
    const contents = await api('get', `/projects/${projectId}/files/contents`, 'bob');
    expect(contents.body.files.find((f: { id: string }) => f.id === mainId).content).toContain(
      '% bob was here',
    );
    a.provider.destroy();
    b.provider.destroy();
  });

  it('enforces read-only for viewers on the server', async () => {
    const name = fileDocName(projectId, mainId);
    const before = (await fileText(mainId)).content;
    const viewer = await connect(name, await token('carol'));
    const editor = await connect(name, await token('alice'));
    viewer.text.insert(0, 'VANDALISM ');
    await new Promise((r) => setTimeout(r, 300));
    expect(editor.text.toString()).toBe(before);
    expect((await fileText(mainId)).content).toBe(before);
    // …but the viewer still receives everyone else's edits live.
    editor.text.insert(0, '% for carol\n');
    await until(() => viewer.text.toString().includes('% for carol'), 'viewer update');
    await settled(editor);
    viewer.provider.destroy();
    editor.provider.destroy();
  });

  it('merges a REST save into the live document instead of overwriting it', async () => {
    const name = fileDocName(projectId, mainId);
    const live = await connect(name, await token('alice'));
    const { content, sha256 } = await fileText(mainId, 'bob');
    const saved = await api('put', `/projects/${projectId}/files/${mainId}/content`, 'bob')
      .set('If-Match', `"${sha256}"`)
      .send({ content: `${content}% saved over REST\n` });
    expect(saved.status).toBe(200);
    if (!REDIS_AVAILABLE) await collab.sweep();
    await until(
      () => live.text.toString().endsWith('% saved over REST\n'),
      'REST edit reaching the editor',
    );
    // A stale If-Match is still refused.
    const stale = await api('put', `/projects/${projectId}/files/${mainId}/content`, 'bob')
      .set('If-Match', `"${sha256}"`)
      .send({ content: 'overwrite' });
    expect(stale.status).toBe(412);
    live.provider.destroy();
  });

  it('keeps state across a collab server restart', async () => {
    const name = fileDocName(projectId, mainId);
    const c = await connect(name, await token('alice'));
    c.text.insert(0, '% before restart\n');
    await settled(c);
    const expected = c.text.toString();
    c.provider.destroy();
    await collab.close();

    collab = startCollab({ COLLAB_STORE_DEBOUNCE_MS: '100', COLLAB_STORE_MAX_DEBOUNCE_MS: '200' });
    wsUrl = `ws://127.0.0.1:${(await collab.listen()).port}/collab`;
    const again = await connect(name, await token('bob'));
    expect(again.text.toString()).toBe(expected);

    // Compaction folds the log into the snapshot and materialises the text.
    again.text.insert(0, '% compacted\n');
    await settled(again);
    const db = createDb(dbUrl, 1);
    await until(async () => {
      const row = await db
        .selectFrom('project_files')
        .select('content_text')
        .where('id', '=', mainId)
        .executeTakeFirstOrThrow();
      return row.content_text === again.text.toString();
    }, 'materialised text');
    const left = await db
      .selectFrom('collab_updates')
      .select('id')
      .where('file_id', '=', mainId)
      .execute();
    await db.destroy();
    expect(left).toHaveLength(0);
    again.provider.destroy();
  });
});

describe('history', () => {
  it('ends a collaborative session with a checkpoint crediting its editors', async () => {
    const name = fileDocName(projectId, mainId);
    const a = await connect(name, await token('alice'));
    const b = await connect(name, await token('bob'));
    a.text.insert(0, '% alice checkpoint\n');
    b.text.insert(0, '% bob checkpoint\n');
    await settled(a);
    await settled(b);
    a.provider.destroy();
    b.provider.destroy();
    const db = createDb(dbUrl, 1);
    await until(async () => {
      const v = await db
        .selectFrom('file_versions')
        .innerJoin('history_blobs', (j) =>
          j
            .onRef('history_blobs.sha256', '=', 'file_versions.sha256')
            .onRef('history_blobs.project_id', '=', 'file_versions.project_id'),
        )
        .select(['file_versions.source', 'file_versions.authors', 'history_blobs.content'])
        .where('file_versions.file_id', '=', mainId)
        .orderBy('file_versions.created_at', 'desc')
        .executeTakeFirst();
      return Boolean(
        v &&
          v.source === 'edit' &&
          v.content.includes('% alice checkpoint') &&
          v.content.includes('% bob checkpoint') &&
          v.authors.includes(ids.alice) &&
          v.authors.includes(ids.bob),
      );
    }, 'checkpoint with both authors');
    await db.destroy();
  });
});

describe('presence', () => {
  it('stamps the authenticated identity on awareness (no spoofing)', async () => {
    const room = projectRoomName(projectId);
    const a = await connect(room, await token('alice'));
    const b = await connect(room, await token('bob'));
    b.provider.awareness!.setLocalState({
      user: { name: 'Mallory', id: ids.alice },
      fileId: mainId,
    });
    await until(
      () => [...a.provider.awareness!.getStates().values()].some((s) => s.fileId === mainId),
      'bob presence',
    );
    const seen = [...a.provider.awareness!.getStates().values()].find((s) => s.fileId === mainId)!;
    expect(seen.user).toMatchObject({ id: ids.bob, name: 'Bob Tran' });
    a.provider.destroy();
    b.provider.destroy();
  });
});

describe('membership and file changes while connected', () => {
  it('downgrades and revokes live connections', async () => {
    const name = fileDocName(projectId, mainId);
    const b = await connect(name, await token('bob'));
    const a = await connect(name, await token('alice'));

    await api('patch', `/projects/${projectId}/members/${ids.bob}`, 'alice').send({
      role: 'viewer',
    });
    if (!REDIS_AVAILABLE) await collab.handleEvent({ type: 'members-changed', projectId });
    await until(
      () => b.notices.some((n) => n.type === 'role-changed' && n.role === 'viewer'),
      'downgrade notice',
    );
    const before = a.text.toString();
    b.text.insert(0, 'now read-only ');
    await new Promise((r) => setTimeout(r, 300));
    expect(a.text.toString()).toBe(before);

    await api('delete', `/projects/${projectId}/members/${ids.bob}`, 'alice');
    if (!REDIS_AVAILABLE) await collab.handleEvent({ type: 'members-changed', projectId });
    await until(
      () => b.notices.some((n) => n.type === 'role-changed' && n.role === null),
      'revocation notice',
    );
    expect((await api('post', `/projects/${projectId}/collab/token`, 'bob')).status).toBe(404);
    a.provider.destroy();
    b.provider.destroy();
  });

  it('notifies editors of a deleted file and refuses to reopen it', async () => {
    const created = await api('post', `/projects/${projectId}/files`, 'alice').send({
      path: 'chapter.tex',
      content: 'Chapter text\n',
    });
    const fileId = created.body.id;
    const name = fileDocName(projectId, fileId);
    const c = await connect(name, await token('alice'));
    expect(c.text.toString()).toBe('Chapter text\n');
    await api('delete', `/projects/${projectId}/files/${fileId}`, 'alice');
    if (!REDIS_AVAILABLE) await collab.handleEvent({ type: 'file-deleted', projectId, fileId });
    await until(() => c.notices.some((n) => n.type === 'file-deleted'), 'deletion notice');
    c.provider.destroy();
    const again = await connect(name, await token('alice'), { wait: false });
    expect(again.failed).not.toBeNull();
  });
});
