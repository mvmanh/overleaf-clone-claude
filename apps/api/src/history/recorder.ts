import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database, HistorySource } from '../database/schema';

type Db = Kysely<Database> | Transaction<Database>;

export interface VersionInput {
  projectId: string;
  fileId: string;
  path: string;
  kind: 'text' | 'binary';
  sha256: string;
  sizeBytes: number;
  blobKey: string | null;
  /** Exact text for text files (stored once per project + hash). */
  text: string | null;
  source: HistorySource;
  authors: string[];
}

/**
 * Appends an immutable checkpoint, inside the caller's transaction.
 *
 * - Unchanged content at the same path is not recorded again (except
 *   deletions and restores, which are events in their own right).
 * - With `coalesceMs`, an edit is skipped while the file's previous
 *   checkpoint is an edit younger than that: autosave does not flood the
 *   history. Labels force a checkpoint of everything that changed.
 */
export async function recordVersion(
  trx: Db,
  v: VersionInput,
  opts: { coalesceMs?: number } = {},
): Promise<boolean> {
  const last = await trx
    .selectFrom('file_versions')
    .select(['sha256', 'path', 'source', 'created_at'])
    .where('file_id', '=', v.fileId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const event = v.source === 'delete' || v.source === 'restore';
  if (
    last &&
    !event &&
    last.source !== 'delete' &&
    last.sha256 === v.sha256 &&
    last.path === v.path
  )
    return false;
  if (
    last &&
    opts.coalesceMs &&
    v.source === 'edit' &&
    last.source === 'edit' &&
    Date.now() - new Date(last.created_at).getTime() < opts.coalesceMs
  )
    return false;
  if (v.text !== null) {
    await trx
      .insertInto('history_blobs')
      .values({ project_id: v.projectId, sha256: v.sha256, content: v.text })
      .onConflict((oc) => oc.columns(['project_id', 'sha256']).doNothing())
      .execute();
  }
  await trx
    .insertInto('file_versions')
    .values({
      project_id: v.projectId,
      file_id: v.fileId,
      path: v.path,
      kind: v.kind,
      sha256: v.sha256,
      size_bytes: v.sizeBytes,
      blob_key: v.blobKey,
      source: v.source,
      authors: [...new Set(v.authors)],
    })
    .execute();
  return true;
}

/**
 * Checkpoints every live file of a freshly created project (template or ZIP
 * import), whose stored text is exact.
 */
export async function recordProjectFiles(
  trx: Db,
  projectId: string,
  source: HistorySource,
  userId: string,
): Promise<void> {
  await sql`
    insert into history_blobs (project_id, sha256, content)
    select project_id, sha256, content_text from project_files
    where project_id = ${projectId} and kind = 'text' and deleted_at is null
    on conflict do nothing`.execute(trx);
  await sql`
    insert into file_versions (project_id, file_id, path, kind, sha256, size_bytes, blob_key, source, authors)
    select project_id, id, path, kind, sha256, size_bytes, blob_key, ${source}, array[${userId}::uuid]
    from project_files where project_id = ${projectId} and deleted_at is null`.execute(trx);
}
