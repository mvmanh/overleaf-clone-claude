import { z } from 'zod';

/**
 * API → collab server notifications (Redis pub/sub). Every collab instance
 * subscribes; each acts on the documents it has loaded. Delivery is
 * best-effort: correctness never depends on it (state lives in Postgres and
 * the collab server re-checks access periodically) — events only make
 * changes show up immediately.
 */
export const COLLAB_EVENTS_CHANNEL = 'lc:collab:events';

const projectId = z.string().uuid();
const fileId = z.string().uuid();

export const CollabEvent = z.discriminatedUnion('type', [
  /** The API appended a Yjs update (REST save, upload replace) for this file. */
  z.object({ type: z.literal('file-updated'), projectId, fileId }),
  z.object({ type: z.literal('file-deleted'), projectId, fileId }),
  /** Files created, renamed, uploaded: clients refetch the tree. */
  z.object({ type: z.literal('files-changed'), projectId }),
  /** Roles changed / members removed / ownership moved: re-check every connection. */
  z.object({ type: z.literal('members-changed'), projectId }),
  /** Name, engine or main file changed. */
  z.object({ type: z.literal('project-changed'), projectId }),
  z.object({ type: z.literal('project-deleted'), projectId }),
]);
export type CollabEvent = z.infer<typeof CollabEvent>;

export function parseCollabEvent(raw: string): CollabEvent | null {
  try {
    const r = CollabEvent.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
