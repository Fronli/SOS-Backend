import { db } from '../db/db';
import { audit_log_table } from '../db/schema';

type DbLike = Pick<typeof db, 'insert'>;

export type AuditInput = {
    actorId?: number | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    metadata?: Record<string, unknown>;
};

/**
 * Writes an audit row. Pass the active transaction so the audit entry commits
 * atomically with the state change it describes.
 */
export async function recordAudit(tx: DbLike, input: AuditInput) {
    await tx.insert(audit_log_table).values({
        actor_id: input.actorId ?? null,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        metadata: input.metadata ?? null,
    });
}
