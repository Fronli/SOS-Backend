import { Request, Response } from 'express';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db/db';
import { audit_log_table, user_table } from '../../db/schema';
import { paginated } from '../../utils/response.util';
import { parsePagination } from '../../utils/pagination.util';

export const listAuditLogs = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : '';
    const entityIdRaw = Number(req.query.entityId);
    const actorIdRaw = Number(req.query.actorId);
    const action = typeof req.query.action === 'string' ? req.query.action : '';

    const filters = [];
    if (entityType) filters.push(eq(audit_log_table.entity_type, entityType));
    if (Number.isInteger(entityIdRaw) && entityIdRaw > 0) filters.push(eq(audit_log_table.entity_id, entityIdRaw));
    if (Number.isInteger(actorIdRaw) && actorIdRaw > 0) filters.push(eq(audit_log_table.actor_id, actorIdRaw));
    if (action) filters.push(eq(audit_log_table.action, action));
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const countBase = db.select({ total: count() }).from(audit_log_table).$dynamic();
    const base = db
        .select({
            id: audit_log_table.id,
            actor_id: audit_log_table.actor_id,
            actor_name: user_table.full_name,
            action: audit_log_table.action,
            entity_type: audit_log_table.entity_type,
            entity_id: audit_log_table.entity_id,
            metadata: audit_log_table.metadata,
            created_at: audit_log_table.created_at,
        })
        .from(audit_log_table)
        .leftJoin(user_table, eq(audit_log_table.actor_id, user_table.id))
        .$dynamic();

    const [countRow] = await (whereClause ? countBase.where(whereClause) : countBase);
    const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(audit_log_table.created_at), desc(audit_log_table.id))
        .limit(limit)
        .offset(offset);

    return paginated(res, 'Jejak audit berhasil diambil', rows, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};
