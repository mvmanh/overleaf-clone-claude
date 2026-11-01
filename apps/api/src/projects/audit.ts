import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../database/schema';

export type AuditAction =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'project.ownership_transferred'
  | 'member.added'
  | 'member.role_changed'
  | 'member.removed'
  | 'member.left'
  | 'file.created'
  | 'file.renamed'
  | 'file.deleted'
  | 'file.uploaded'
  | 'file.replaced'
  | 'project.imported';

/** Appends an audit event inside the caller's transaction (all-or-nothing with the change). */
export async function recordAudit(
  db: Kysely<Database> | Transaction<Database>,
  event: {
    projectId: string;
    actorId: string;
    action: AuditAction;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .insertInto('project_audit_events')
    .values({
      project_id: event.projectId,
      actor_id: event.actorId,
      action: event.action,
      metadata: JSON.stringify(event.metadata ?? {}),
    })
    .execute();
}
