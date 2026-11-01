import { createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import * as Y from 'yjs';
import { buildDoc, seedDoc, textOf } from '@latex-cloud/collab-protocol';
import type { CollabDatabase } from './db';

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

export interface LoadedState {
  state: Uint8Array;
  updates: Uint8Array[];
  /** True when this load created the Yjs state from the stored text. */
  seeded: boolean;
}

/**
 * Durable Yjs persistence.
 *
 * - **Write path**: every client update is appended to `collab_updates`
 *   *before* it is applied and acknowledged (see server.ts `beforeSync`). The
 *   "Synced" state a client shows therefore means "committed in Postgres":
 *   RPO for acknowledged edits is zero. Unacknowledged edits stay in the
 *   client's Y.Doc and are re-sent on reconnect.
 * - **Compaction** (`compact`, debounced): folds the log into the
 *   `collab_documents` snapshot and materialises plain text into
 *   `project_files.content_text` for compiles, ZIP export and search.
 * - **Load**: snapshot + remaining log. The first collaborative open of a file
 *   seeds the Yjs state from its stored text — once, under a row lock, so two
 *   servers can never seed the same file twice (which would duplicate text).
 *
 * Lock order: `project_files` row `FOR NO KEY UPDATE` (taken by seeding,
 * compaction and API edits) serialises them per file without blocking the
 * append path, whose foreign key only needs `KEY SHARE`.
 */
export class CollabStore {
  constructor(private readonly db: Kysely<CollabDatabase>) {}

  async load(fileId: string): Promise<LoadedState> {
    const existing = await this.read(this.db, fileId);
    if (existing) return { ...existing, seeded: false };
    return this.db.transaction().execute(async (trx) => {
      const file = await trx
        .selectFrom('project_files')
        .select(['content_text', 'kind'])
        .where('id', '=', fileId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!file || file.kind !== 'text') throw new Error('not a text file');
      // Another instance (or a previous attempt) may have seeded meanwhile.
      const again = await this.read(trx, fileId);
      if (again) return { ...again, seeded: false };
      const state = Y.encodeStateAsUpdate(seedDoc(file.content_text ?? ''));
      await trx
        .insertInto('collab_documents')
        .values({ file_id: fileId, state: Buffer.from(state) })
        .execute();
      return { state, updates: [], seeded: true };
    });
  }

  private async read(db: Kysely<CollabDatabase>, fileId: string) {
    const snap = await db
      .selectFrom('collab_documents')
      .select('state')
      .where('file_id', '=', fileId)
      .executeTakeFirst();
    if (!snap) return null;
    const rows = await db
      .selectFrom('collab_updates')
      .select('data')
      .where('file_id', '=', fileId)
      .orderBy('id')
      .execute();
    return { state: new Uint8Array(snap.state), updates: rows.map((r) => new Uint8Array(r.data)) };
  }

  /** Durable append of one client update. Resolves once committed. */
  async append(fileId: string, update: Uint8Array, userId: string | null): Promise<void> {
    await this.db
      .insertInto('collab_updates')
      .values({ file_id: fileId, data: Buffer.from(update), source: 'client', user_id: userId })
      .execute();
  }

  /** Updates written by the API (REST save, upload replace) for a loaded document. */
  async apiUpdates(fileId: string): Promise<Uint8Array[]> {
    const rows = await this.db
      .selectFrom('collab_updates')
      .select('data')
      .where('file_id', '=', fileId)
      .where('source', '=', 'api')
      .orderBy('id')
      .execute();
    return rows.map((r) => new Uint8Array(r.data));
  }

  /**
   * Folds the log into the snapshot and materialises text. Any logged update
   * the live document has not seen (an API edit whose event was missed) is
   * applied first, so deleting the folded rows can never lose an edit.
   * Returns the materialised text.
   */
  async compact(
    fileId: string,
    doc: Y.Doc,
    opts: { userId: string | null; applyOrigin: unknown },
  ): Promise<{ text: string; changed: boolean; folded: number }> {
    return this.db.transaction().execute(async (trx) => {
      const file = await trx
        .selectFrom('project_files')
        .select(['sha256'])
        .where('id', '=', fileId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!file) return { text: textOf(doc), changed: false, folded: 0 };
      const rows = await trx
        .selectFrom('collab_updates')
        .select(['id', 'data'])
        .where('file_id', '=', fileId)
        .orderBy('id')
        .execute();
      // Idempotent: updates the document already has are no-ops.
      Y.transact(
        doc,
        () =>
          buildDoc(
            null,
            rows.map((r) => new Uint8Array(r.data)),
            doc,
          ),
        opts.applyOrigin,
      );
      const state = Buffer.from(Y.encodeStateAsUpdate(doc));
      const text = textOf(doc);
      await trx
        .insertInto('collab_documents')
        .values({ file_id: fileId, state })
        .onConflict((oc) => oc.column('file_id').doUpdateSet({ state, updated_at: sql`now()` }))
        .execute();
      if (rows.length) {
        // Exactly the rows folded in: appends committed meanwhile stay in the log.
        await trx
          .deleteFrom('collab_updates')
          .where('id', '=', sql<string>`any(${sql.val(rows.map((r) => r.id))}::bigint[])`)
          .execute();
      }
      const sha = sha256Hex(text);
      const changed = sha !== file.sha256;
      if (changed) {
        await trx
          .updateTable('project_files')
          .set({
            content_text: text,
            sha256: sha,
            size_bytes: Buffer.byteLength(text, 'utf8'),
            updated_by: opts.userId,
            updated_at: sql`now()`,
          })
          .where('id', '=', fileId)
          .execute();
      }
      return { text, changed, folded: rows.length };
    });
  }
}
