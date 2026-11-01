import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Forbidden } from '@hocuspocus/common';
import {
  type Connection,
  type Document,
  type Extension,
  type Hocuspocus,
  Server,
} from '@hocuspocus/server';
import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import * as Y from 'yjs';
import {
  assertValidUpdate,
  buildDoc,
  COLLAB_EVENTS_CHANNEL,
  type CollabEvent,
  isEmptyUpdate,
  parseCollabEvent,
  verifyCollabToken,
  Y as ProtocolY,
} from '@latex-cloud/collab-protocol';
import {
  can,
  type CollabDocRef,
  type CollabNotice,
  type CollabUser,
  collabColorFor,
  parseCollabDocName,
  projectRoomName,
  type ProjectRole,
} from '@latex-cloud/shared';
import { CollabAccess } from './access';
import type { CollabConfig } from './config';
import { type CollabDatabase, createCollabDb } from './db';
import { log } from './log';
import { CollabStore } from './store';

/** Per-connection identity, set by onAuthenticate. */
export interface CollabContext {
  userId: string;
  projectId: string;
  role: ProjectRole;
  user: CollabUser;
  ref: CollabDocRef;
}

/** One update may not exceed this (a paste of a whole 2 MB file fits). */
const MAX_UPDATE_BYTES = 4 * 1024 * 1024;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Origin for updates the server applies itself (API edits). */
const SERVER_ORIGIN = { source: 'local' as const };

const reject = (reason: string): never => {
  // Hocuspocus closes the connection for this document with the thrown value.
  throw Object.assign(new Error(reason), { reason: Forbidden.reason, code: Forbidden.code });
};

const notice = (n: CollabNotice) => JSON.stringify(n);

const isFileWriter = (ref: CollabDocRef, role: ProjectRole) =>
  ref.kind === 'file' && can(role, 'files:write');

export interface CollabServerDeps {
  db?: Kysely<CollabDatabase>;
  /** Pass null to run without Redis events (tests); a periodic sweep still runs. */
  redis?: Redis | null;
}

export interface CollabServer {
  hocuspocus: Hocuspocus<CollabContext>;
  listen(): Promise<{ port: number }>;
  /** Persists every open document, then stops. */
  close(): Promise<void>;
  /** Applies an API → collab event (also what the Redis subscriber calls). */
  handleEvent(ev: CollabEvent): Promise<void>;
  /** Runs the periodic access + API-update sweep now (tests). */
  sweep(): Promise<void>;
}

export function createCollabServer(
  config: CollabConfig,
  deps: CollabServerDeps = {},
): CollabServer {
  // Two copies of Yjs (e.g. a CJS and an ESM build) silently break merging.
  if (ProtocolY.Doc !== Y.Doc) throw new Error('two Yjs instances are loaded; fix the packaging');
  const db = deps.db ?? createCollabDb(config.DATABASE_URL, config.DATABASE_POOL_MAX);
  const ownsDb = !deps.db;
  const store = new CollabStore(db);
  const access = new CollabAccess(db);
  const allowedOrigins = new Set(config.WEB_ORIGIN.map((o) => new URL(o).origin));

  const ownerOf = (doc: Document, clientId: number): Connection | null => {
    for (const [conn, { clients }] of doc.connections) if (clients.has(clientId)) return conn;
    return null;
  };

  const docsOfProject = (projectId: string): Array<[CollabDocRef, Document]> => {
    const out: Array<[CollabDocRef, Document]> = [];
    for (const [name, doc] of hocuspocus.documents) {
      const ref = parseCollabDocName(name);
      if (ref && ref.projectId === projectId) out.push([ref, doc]);
    }
    return out;
  };

  const hooks: Partial<Extension<CollabContext>> = {
    async onUpgrade({ request, socket }: { request: IncomingMessage; socket: Duplex }) {
      const path = (request.url ?? '/').split('?')[0];
      const origin = request.headers.origin;
      const badPath = path !== '/' && path !== '/collab';
      const badOrigin = origin !== undefined && !allowedOrigins.has(origin);
      if (badPath || badOrigin) {
        log('warn', 'upgrade.rejected', { path, origin, reason: badPath ? 'path' : 'origin' });
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        // A falsy rejection stops Hocuspocus without an error.
        throw null;
      }
    },

    async onRequest({ request, response }) {
      const path = (request.url ?? '/').split('?')[0];
      if (path === '/health' || path === '/ready') {
        let ok = true;
        if (path === '/ready') {
          try {
            await db.selectFrom('projects').select('id').limit(1).execute();
          } catch {
            ok = false;
          }
        }
        response.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            status: ok ? 'ok' : 'unavailable',
            documents: hocuspocus.getDocumentsCount(),
            connections: hocuspocus.getConnectionsCount(),
          }),
        );
      } else {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Not found');
      }
      throw null;
    },

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const ref = parseCollabDocName(documentName) ?? reject('unknown document');
      const verified = verifyCollabToken(config.COLLAB_TOKEN_SECRET, token);
      if (!verified.ok) reject(`token ${verified.reason}`);
      const claims = verified.ok ? verified.claims : null!;
      if (claims.pid !== ref.projectId) reject('token is for another project');
      // The token proves identity; the role is always read fresh.
      const role = (await access.roleOf(claims.sub, ref.projectId)) ?? reject('not a member');
      if (ref.kind === 'file' && !(await access.isLiveTextFile(ref.projectId, ref.fileId)))
        reject('file not found');
      // The project room carries presence only: nobody writes its document.
      connectionConfig.readOnly = !isFileWriter(ref, role);
      const name = await access.displayName(claims.sub);
      const context: CollabContext = {
        userId: claims.sub,
        projectId: ref.projectId,
        role,
        ref,
        user: { id: claims.sub, name, ...collabColorFor(claims.sub) },
      };
      log('info', 'connect', { doc: documentName, user: claims.sub, role, jti: claims.jti });
      return context;
    },

    async onLoadDocument({ document, documentName }) {
      const ref = parseCollabDocName(documentName);
      if (ref?.kind !== 'file') return document;
      const loaded = await store.load(ref.fileId);
      const { failed } = buildDoc(loaded.state, loaded.updates, document);
      if (failed) log('error', 'load.corrupt-updates', { doc: documentName, failed });
      log('info', 'load', {
        doc: documentName,
        seeded: loaded.seeded,
        logLength: loaded.updates.length,
      });
      return document;
    },

    /**
     * Durability: persist before apply. Runs for every sync message, inside the
     * connection's sequential queue, *before* Hocuspocus applies the update and
     * sends the SyncStatus acknowledgement — so an acknowledged edit is always
     * in Postgres. If the write fails the connection is reset and the client
     * keeps (and later re-sends) its unacknowledged changes.
     */
    async beforeSync({ connection, type, payload }) {
      if (type !== SYNC_STEP2 && type !== SYNC_UPDATE) return;
      if (connection.readOnly) return; // Hocuspocus refuses it anyway
      const ctx = connection.context;
      if (ctx.ref.kind !== 'file' || isEmptyUpdate(payload)) return;
      if (payload.byteLength > MAX_UPDATE_BYTES) reject('update too large');
      try {
        assertValidUpdate(payload);
      } catch {
        reject('malformed update');
      }
      await store.append(ctx.ref.fileId, payload, ctx.userId);
    },

    /**
     * Presence is scoped to members and cannot be spoofed: the identity in
     * every awareness state is the authenticated user's, and a connection may
     * only set or clear the states of its own Yjs clients.
     */
    async beforeHandleAwareness({ connection, document, states, removedClients }) {
      if (!connection) return;
      const ctx = connection.context;
      for (const [clientId, state] of states) {
        const owner = ownerOf(document, clientId);
        if (owner && owner !== connection) {
          states.delete(clientId);
          continue;
        }
        if (ctx.ref.kind === 'project') {
          const fileId =
            typeof state.fileId === 'string' && UUID.test(state.fileId) ? state.fileId : null;
          for (const k of Object.keys(state)) delete state[k];
          state.fileId = fileId;
        }
        state.user = ctx.user;
      }
      for (const clientId of removedClients) {
        const owner = ownerOf(document, clientId);
        if (owner && owner !== connection) removedClients.delete(clientId);
      }
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const ref = parseCollabDocName(documentName);
      if (ref?.kind !== 'file') return;
      const started = Date.now();
      const r = await store.compact(ref.fileId, document, {
        userId: (lastContext as CollabContext | undefined)?.userId ?? null,
        applyOrigin: SERVER_ORIGIN,
      });
      // Other files' sizes and hashes changed: clients refresh the tree and
      // the autocomplete index (labels, \cite keys defined in this file).
      if (r.changed)
        hocuspocus.documents
          .get(projectRoomName(ref.projectId))
          ?.broadcastStateless(notice({ type: 'files-changed' }));
      log('info', 'store', {
        doc: documentName,
        folded: r.folded,
        changed: r.changed,
        ms: Date.now() - started,
      });
    },
  };

  const server = new Server<CollabContext>({
    name: 'latex-cloud-collab',
    port: config.COLLAB_PORT,
    address: config.COLLAB_HOST,
    quiet: true,
    stopOnSignals: false,
    debounce: config.COLLAB_STORE_DEBOUNCE_MS,
    maxDebounce: config.COLLAB_STORE_MAX_DEBOUNCE_MS,
    unloadImmediately: true,
    websocketOptions: { maxPayload: MAX_UPDATE_BYTES + 64 * 1024 },
    extensions: [hooks as Extension],
  });
  const hocuspocus = server.hocuspocus;

  /** Applies API-written updates to a loaded document (idempotent). */
  async function pullApiUpdates(fileId: string, doc: Document): Promise<void> {
    const updates = await store.apiUpdates(fileId);
    if (updates.length) Y.transact(doc, () => buildDoc(null, updates, doc), SERVER_ORIGIN);
  }

  /** Re-reads every member's role and adjusts or closes their connections. */
  async function revalidate(projectId: string): Promise<void> {
    const docs = docsOfProject(projectId);
    if (!docs.length) return;
    const roles = await access.roles(projectId);
    for (const [ref, doc] of docs) {
      for (const conn of doc.getConnections()) {
        const ctx = conn.context as CollabContext;
        const role = roles.get(ctx.userId) ?? null;
        if (role === ctx.role) continue;
        conn.sendStateless(notice({ type: 'role-changed', role }));
        if (!role) {
          log('info', 'access.revoked', { doc: doc.name, user: ctx.userId });
          conn.close(Forbidden);
          continue;
        }
        ctx.role = role;
        conn.readOnly = !isFileWriter(ref, role);
      }
    }
  }

  async function handleEvent(ev: CollabEvent): Promise<void> {
    const room = hocuspocus.documents.get(projectRoomName(ev.projectId));
    switch (ev.type) {
      case 'file-updated': {
        const doc = docsOfProject(ev.projectId).find(
          ([ref]) => ref.kind === 'file' && ref.fileId === ev.fileId,
        )?.[1];
        if (doc) await pullApiUpdates(ev.fileId, doc);
        room?.broadcastStateless(notice({ type: 'files-changed' }));
        return;
      }
      case 'file-deleted': {
        const doc = docsOfProject(ev.projectId).find(
          ([ref]) => ref.kind === 'file' && ref.fileId === ev.fileId,
        )?.[1];
        if (doc) {
          // Editors keep their buffer (preservation over silent loss) and stop syncing.
          doc.broadcastStateless(notice({ type: 'file-deleted', fileId: ev.fileId }));
          setTimeout(() => hocuspocus.closeConnections(doc.name), 250).unref();
        }
        room?.broadcastStateless(notice({ type: 'files-changed' }));
        return;
      }
      case 'files-changed':
        room?.broadcastStateless(notice({ type: 'files-changed' }));
        return;
      case 'project-changed':
        room?.broadcastStateless(notice({ type: 'project-changed' }));
        return;
      case 'members-changed':
        await revalidate(ev.projectId);
        return;
      case 'project-deleted':
        for (const [, doc] of docsOfProject(ev.projectId)) {
          doc.broadcastStateless(notice({ type: 'role-changed', role: null }));
          hocuspocus.closeConnections(doc.name);
        }
        return;
    }
  }

  /** Backstop for missed events: access re-check and API edits, every open document. */
  async function sweep(): Promise<void> {
    const projects = new Set<string>();
    for (const [name, doc] of hocuspocus.documents) {
      const ref = parseCollabDocName(name);
      if (!ref) continue;
      projects.add(ref.projectId);
      if (ref.kind === 'file') await pullApiUpdates(ref.fileId, doc);
    }
    for (const p of projects) await revalidate(p);
  }

  let subscriber: Redis | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;

  return {
    hocuspocus,
    handleEvent,
    sweep,
    async listen() {
      if (deps.redis !== null) {
        subscriber = deps.redis ?? new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
        subscriber.on('error', (e) => log('warn', 'redis.error', { message: e.message }));
        subscriber.on('message', (_channel, raw: string) => {
          const ev = parseCollabEvent(raw);
          if (!ev) return;
          handleEvent(ev).catch((e: unknown) =>
            log('error', 'event.failed', { type: ev.type, message: String(e) }),
          );
        });
        await subscriber.subscribe(COLLAB_EVENTS_CHANNEL);
      }
      sweepTimer = setInterval(() => {
        sweep().catch((e: unknown) => log('error', 'sweep.failed', { message: String(e) }));
      }, config.COLLAB_ACCESS_RECHECK_MS);
      sweepTimer.unref();
      await server.listen();
      return { port: server.address.port };
    },
    async close() {
      if (sweepTimer) clearInterval(sweepTimer);
      // Snapshot everything still open before the process goes away.
      hocuspocus.flushPendingStores();
      await server.destroy();
      subscriber?.disconnect();
      if (ownsDb) await db.destroy();
    },
  };
}
