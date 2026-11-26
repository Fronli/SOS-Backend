import { Request, Response } from 'express';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db/db';
import { report_table, request_table, user_table } from '../../db/schema';
import { recordAudit } from '../../services/audit.service';
import { notify } from '../../services/notification.service';
import { fail, ok, paginated } from '../../utils/response.util';
import { parseId } from '../../utils/id.util';
import { parsePagination } from '../../utils/pagination.util';
import { sendCsv, toCsv } from '../../utils/csv.util';
import { enumValue } from '../../utils/enum.util';

export const listReports = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const targetType = enumValue(['REQUEST', 'USER'] as const, req.query.targetType);
    const status = enumValue(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const, req.query.status);

    const filters = [];
    if (targetType) filters.push(eq(report_table.target_type, targetType));
    if (status) filters.push(eq(report_table.status, status));
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const countBase = db.select({ total: count() }).from(report_table).$dynamic();
    const base = db.select().from(report_table).$dynamic();

    const [countRow] = await (whereClause ? countBase.where(whereClause) : countBase);
    const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(report_table.created_at), desc(report_table.id))
        .limit(limit)
        .offset(offset);

    const data = await Promise.all(rows.map(async (row) => {
        const [reporter] = await db
            .select({ id: user_table.id, full_name: user_table.full_name, email: user_table.email })
            .from(user_table).where(eq(user_table.id, row.reporter_id)).limit(1);
        return { ...row, reporter: reporter ?? null };
    }));

    return paginated(res, 'Daftar laporan berhasil diambil', data, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

export const getReport = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID laporan tidak valid.');

    const [row] = await db.select().from(report_table).where(eq(report_table.id, id)).limit(1);
    if (!row) return fail(res, 404, 'Laporan tidak ditemukan.');

    const [reporter] = await db
        .select({ id: user_table.id, full_name: user_table.full_name, email: user_table.email })
        .from(user_table).where(eq(user_table.id, row.reporter_id)).limit(1);

    let target: unknown = null;
    if (row.target_type === 'REQUEST') {
        const [request] = await db.select({
            id: request_table.id,
            title: request_table.title,
            description: request_table.description,
            status: request_table.status,
            requester_id: request_table.requester_id,
            created_at: request_table.created_at,
        }).from(request_table).where(eq(request_table.id, row.target_id)).limit(1);
        target = request ?? null;
    } else {
        const [user] = await db.select({
            id: user_table.id,
            full_name: user_table.full_name,
            email: user_table.email,
            status: user_table.status,
        }).from(user_table).where(eq(user_table.id, row.target_id)).limit(1);
        target = user ?? null;
    }

    return ok(res, 'Detail laporan berhasil diambil', {
        ...row,
        reporter: reporter ?? null,
        target,
    });
};

export const claimReport = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID laporan tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(report_table)
            .where(eq(report_table.id, id)).for('update');
        if (!row) return { error: true as const, status: 404, message: 'Laporan tidak ditemukan.' };
        if (row.status === 'RESOLVED' || row.status === 'DISMISSED') {
            return { error: true as const, status: 409, message: 'Laporan sudah ditutup.' };
        }
        if (row.status === 'IN_REVIEW' && row.claimed_by === adminId) {
            return { error: false as const, row };
        }

        const [updated] = await tx.update(report_table)
            .set({ status: 'IN_REVIEW', claimed_by: adminId, claimed_at: new Date() })
            .where(eq(report_table.id, id)).returning();

        await recordAudit(tx, {
            actorId: adminId,
            action: 'report.claim',
            entityType: 'report',
            entityId: id,
        });
        return { error: false as const, row: updated };
    });

    if (result.error) return fail(res, result.status, result.message);
    return ok(res, 'Laporan ditandai sedang ditinjau', {
        id: result.row.id,
        status: result.row.status,
        claimed_at: result.row.claimed_at,
    });
};

async function closeReport(
    req: Request,
    res: Response,
    outcome: 'RESOLVED' | 'DISMISSED',
) {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID laporan tidak valid.');

    const action = typeof req.body?.action === 'string' ? req.body.action : null;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (outcome === 'RESOLVED' && !action) return fail(res, 400, 'action wajib diisi.');
    if (!reason) return fail(res, 400, 'reason wajib diisi.');

    const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(report_table)
            .where(eq(report_table.id, id)).for('update');
        if (!row) return { error: true as const, status: 404, message: 'Laporan tidak ditemukan.' };
        if (row.status === 'RESOLVED' || row.status === 'DISMISSED') {
            return { error: true as const, status: 409, message: 'Laporan sudah ditutup.' };
        }

        const now = new Date();
        await tx.update(report_table).set({
            status: outcome,
            resolution_action: action,
            resolution_reason: reason,
            resolved_by: adminId,
            resolved_at: now,
            claimed_by: row.claimed_by ?? adminId,
            claimed_at: row.claimed_at ?? now,
        }).where(eq(report_table.id, id));

        await notify(tx, row.reporter_id, {
            type: outcome === 'RESOLVED' ? 'report.resolved' : 'report.dismissed',
            title: outcome === 'RESOLVED' ? 'Laporan ditindaklanjuti' : 'Laporan ditutup',
            body: reason,
            data: { report_id: id, action },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: outcome === 'RESOLVED' ? 'report.resolve' : 'report.dismiss',
            entityType: 'report',
            entityId: id,
            metadata: { action, reason, target_type: row.target_type, target_id: row.target_id },
        });
        return { error: false as const };
    });

    if (result.error) return fail(res, result.status, result.message);
    return ok(res, outcome === 'RESOLVED' ? 'Laporan diselesaikan' : 'Laporan ditutup tanpa tindakan', {
        id, status: outcome,
    });
}

export const resolveReport = async (req: Request, res: Response) => closeReport(req, res, 'RESOLVED');
export const dismissReport = async (req: Request, res: Response) => closeReport(req, res, 'DISMISSED');

export const exportReports = async (_req: Request, res: Response) => {
    const rows = await db.select({
        id: report_table.id,
        reporter_id: report_table.reporter_id,
        target_type: report_table.target_type,
        target_id: report_table.target_id,
        reason: report_table.reason,
        status: report_table.status,
        created_at: report_table.created_at,
        resolved_at: report_table.resolved_at,
    }).from(report_table).orderBy(desc(report_table.created_at));

    return sendCsv(res, 'reports.csv', toCsv(rows));
};
