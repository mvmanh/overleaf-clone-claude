import { Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { buildDoc, replaceText, textOf } from '@latex-cloud/collab-protocol';
import type { Database } from '../database/schema';

type Db = Kysely<Database> | Transaction<Database>;

/**
 * Reads and writes file text when the Yjs document is the authority
 * (ADR-0014). `project_files.content_text` is the materialised text of the
 * Yjs snapshot; edits newer than the last compaction live in
 * `collab_updates`, so readers that need the exact current text (compiles,
 * export, autocomplete index) replay them.
 */
@Injectable()
export class CollabTextService {
  /**
   * Current text of each file: `content_text`, or the Yjs state replayed for
   * files with un-compacted updates. Run inside the caller's transaction for
   * a consistent cross-file snapshot.
   */
  async liveTexts(
    db: Db,
    files: ReadonlyArray<{ id: string; content_text: string | null }>,
  ): Promise<Map<string, string>> {
    const out = new Map(files.map((f) => [f.id, f.content_text ?? '']));
    if (!files.length) return out;
    const pending = await db
      .selectFrom('collab_updates')
      .select('file_id')
      .distinct()
      .where(
        'file_id',
        'in',
        files.map((f) => f.id),
      )
      .execute();
    if (!pending.length) return out;
    const ids = pending.map((p) => p.file_id);
    const [snapshots, updates] = await Promise.all([
      db
        .selectFrom('collab_documents')
        .select(['file_id', 'state'])
        .where('file_id', 'in', ids)
        .execute(),
      db
        .selectFrom('collab_updates')
        .select(['file_id', 'data'])
        .where('file_id', 'in', ids)
        .orderBy('id')
        .execute(),
    ]);
    const states = new Map(snapshots.map((s) => [s.file_id, new Uint8Array(s.state)]));
    for (const id of ids) {
      const log = updates.filter((u) => u.file_id === id).map((u) => new Uint8Array(u.data));
      out.set(id, textOf(buildDoc(states.get(id) ?? null, log).doc));
    }
    return out;
  }

  async liveText(db: Db, file: { id: string; content_text: string | null }): Promise<string> {
    return (await this.liveTexts(db, [file])).get(file.id) ?? '';
  }

  /**
   * Applies a whole-text replacement (REST save, upload replace) as a minimal
   * Yjs edit, so collaborators' concurrent changes merge instead of being
   * overwritten. Caller must hold the file row `FOR NO KEY UPDATE` and publish
   * a `file-updated` event after commit. Returns false when the file has no
   * Yjs state yet (plain text is then the authority).
   */
  async applyExternalEdit(
    trx: Transaction<Database>,
    fileId: string,
    next: string,
    userId: string,
  ): Promise<boolean> {
    const snap = await trx
      .selectFrom('collab_documents')
      .select('state')
      .where('file_id', '=', fileId)
      .executeTakeFirst();
    if (!snap) return false;
    const log = await trx
      .selectFrom('collab_updates')
      .select('data')
      .where('file_id', '=', fileId)
      .orderBy('id')
      .execute();
    const { doc } = buildDoc(
      new Uint8Array(snap.state),
      log.map((r) => new Uint8Array(r.data)),
    );
    const update = replaceText(doc, next);
    if (update) {
      await trx
        .insertInto('collab_updates')
        .values({ file_id: fileId, data: Buffer.from(update), source: 'api', user_id: userId })
        .execute();
    }
    return true;
  }
}
