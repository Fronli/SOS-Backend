import { Request, Response } from 'express';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db/db';
import { request_table, user_table } from '../../db/schema';
import { recordAudit } from '../../services/audit.service';
import { notify } from '../../services/notification.service';
import { fail, ok, paginated } from '../../utils/response.util';
import { parseId } from '../../utils/id.util';
import { parsePagination } from '../../utils/pagination.util';
import { enumValue } from '../../utils/enum.util';

const ACTIONS = ['HIDE', 'REMOVE', 'KEEP'] as const;
type ModerationAction = typeof ACTIONS[number];

export const moderateRequest = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID request tidak valid.');

    const action = req.body?.action as ModerationAction;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!ACTIONS.includes(action)) {
        return fail(res, 400, `action harus salah satu dari: ${ACTIONS.join(', ')}.`);
    }
    if (!reason) return fail(res, 400, 'reason wajib diisi.');

    const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(request_table)
            .where(eq(request_table.id, id)).for('update');
        if (!row) return { error: true as const, status: 404, message: 'Request tidak ditemukan.' };

        const now = new Date();
        const patch = action === 'HIDE'
            ? { status: 'HIDDEN' as const, hidden_at: now, hidden_by: adminId, moderation_reason: reason, updated_at: now }
            : action === 'REMOVE'
                ? { status: 'REMOVED' as const, hidden_at: now, hidden_by: adminId, moderation_reason: reason, updated_at: now }
                : { status: 'OPEN' as const, hidden_at: null, hidden_by: null, moderation_reason: null, updated_at: now };

        await tx.update(request_table).set(patch).where(eq(request_table.id, id));

        await notify(tx, row.requester_id, {
            type: 'request.moderated',
            title: action === 'KEEP' ? 'Request dipertahankan' : 'Request dimoderasi',
            body: reason,
            data: { request_id: id, action },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: `request.moderate.${action.toLowerCase()}`,
            entityType: 'request',
            entityId: id,
            metadata: { reason, previous_status: row.status },
        });

        return { error: false as const, status: patch.status };
    });

    if (result.error) return fail(res, result.status, result.message);
    return ok(res, 'Tindakan moderasi disimpan', { id, status: result.status, action });
};

export const restoreRequest = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID request tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(request_table)
            .where(eq(request_table.id, id)).for('update');
        if (!row) return { error: true as const, status: 404, message: 'Request tidak ditemukan.' };
        if (row.status !== 'HIDDEN' && row.status !== 'REMOVED') {
            return { error: true as const, status: 409, message: 'Hanya request yang disembunyikan/dihapus yang dapat dipulihkan.' };
        }

        await tx.update(request_table).set({
            status: 'OPEN',
            hidden_at: null,
            hidden_by: null,
            moderation_reason: null,
            deleted_at: null,
            updated_at: new Date(),
        }).where(eq(request_table.id, id));

        await notify(tx, row.requester_id, {
            type: 'request.restored',
            title: 'Request dipulihkan',
            body: 'Request Anda telah dipulihkan dan kembali tampil.',
            data: { request_id: id },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: 'request.restore',
            entityType: 'request',
            entityId: id,
            metadata: { previous_status: row.status },
        });
        return { error: false as const };
    });

    if (result.error) return fail(res, result.status, result.message);
    return ok(res, 'Request berhasil dipulihkan', { id, status: 'OPEN' });
};

export const listModeratedRequests = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const status = enumValue(['OPEN', 'CANCELLED', 'COMPLETED', 'HIDDEN', 'REMOVED'] as const, req.query.status);

    const filters = [];
    if (status) filters.push(eq(request_table.status, status));
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const countBase = db.select({ total: count() }).from(request_table).$dynamic();
    const base = db
        .select({
            id: request_table.id,
            title: request_table.title,
            status: request_table.status,
            moderation_reason: request_table.moderation_reason,
            hidden_at: request_table.hidden_at,
            hidden_by: request_table.hidden_by,
            created_at: request_table.created_at,
            requester: { id: user_table.id, full_name: user_table.full_name, email: user_table.email },
        })
        .from(request_table)
        .innerJoin(user_table, eq(request_table.requester_id, user_table.id))
        .$dynamic();

    const [countRow] = await (whereClause ? countBase.where(whereClause) : countBase);
    const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(request_table.created_at))
        .limit(limit)
        .offset(offset);

    return paginated(res, 'Daftar request termoderasi berhasil diambil', rows, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};
