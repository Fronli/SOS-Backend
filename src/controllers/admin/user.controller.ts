import { Request, Response } from 'express';
import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { db } from '../../db/db';
import {
    assignment_table, refresh_token_table, report_table, request_table, user_table,
} from '../../db/schema';
import { recordAudit } from '../../services/audit.service';
import { notify } from '../../services/notification.service';
import { serializePublicProfile } from '../../services/user.service';
import { fail, ok, paginated } from '../../utils/response.util';
import { parseId } from '../../utils/id.util';
import { parsePagination } from '../../utils/pagination.util';
import { sendCsv, toCsv } from '../../utils/csv.util';
import { enumValue } from '../../utils/enum.util';

export const listUsers = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const status = enumValue(['ACTIVE', 'SUSPENDED'] as const, req.query.status);
    const role = enumValue(['USER', 'ADMIN'] as const, req.query.role);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const filters = [];
    if (status) filters.push(eq(user_table.status, status));
    if (role) filters.push(eq(user_table.role, role));
    if (q) {
        const escaped = q.replace(/[%_\\]/g, '\\$&');
        filters.push(or(
            ilike(user_table.full_name, `%${escaped}%`),
            ilike(user_table.email, `%${escaped}%`),
            ilike(user_table.university, `%${escaped}%`),
        )!);
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const countBase = db.select({ total: count() }).from(user_table).$dynamic();
    const base = db
        .select({
            id: user_table.id,
            full_name: user_table.full_name,
            email: user_table.email,
            university: user_table.university,
            major: user_table.major,
            role: user_table.role,
            status: user_table.status,
            email_verified_at: user_table.email_verified_at,
            student_verified_at: user_table.student_verified_at,
            suspended_until: user_table.suspended_until,
            created_at: user_table.created_at,
        })
        .from(user_table)
        .$dynamic();

    const [countRow] = await (whereClause ? countBase.where(whereClause) : countBase);
    const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(user_table.created_at), desc(user_table.id))
        .limit(limit)
        .offset(offset);

    return paginated(res, 'Daftar pengguna berhasil diambil', rows, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

export const getUserDetail = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID user tidak valid.');

    const [user] = await db.select({
        id: user_table.id,
        full_name: user_table.full_name,
        email: user_table.email,
        university: user_table.university,
        major: user_table.major,
        role: user_table.role,
        status: user_table.status,
        email_verified_at: user_table.email_verified_at,
        student_verified_at: user_table.student_verified_at,
        suspended_until: user_table.suspended_until,
        suspended_reason: user_table.suspended_reason,
        last_login_at: user_table.last_login_at,
        created_at: user_table.created_at,
    }).from(user_table).where(eq(user_table.id, id)).limit(1);

    if (!user) return fail(res, 404, 'Pengguna tidak ditemukan.');

    const [
        [requestCount], [assignmentCount], [completedCount], [reportCount], profile,
    ] = await Promise.all([
        db.select({ total: count() }).from(request_table)
            .where(and(eq(request_table.requester_id, id), isNull(request_table.deleted_at))),
        db.select({ total: count() }).from(assignment_table)
            .where(or(eq(assignment_table.requester_id, id), eq(assignment_table.helper_id, id))),
        db.select({ total: count() }).from(assignment_table)
            .where(and(eq(assignment_table.helper_id, id), eq(assignment_table.status, 'COMPLETED'))),
        db.select({ total: count() }).from(report_table)
            .where(and(eq(report_table.target_type, 'USER'), eq(report_table.target_id, id))),
        serializePublicProfile(id, { includePortfolio: true, includeSkills: true, includeStats: true }),
    ]);

    return ok(res, 'Detail pengguna berhasil diambil', {
        ...user,
        request_count: Number(requestCount?.total ?? 0),
        assignment_count: Number(assignmentCount?.total ?? 0),
        completed_helps: Number(completedCount?.total ?? 0),
        report_count: Number(reportCount?.total ?? 0),
        profile,
    });
};

export const suspendUser = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID user tidak valid.');

    const days = req.body?.days;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return fail(res, 400, 'reason wajib diisi.');
    if (days !== null && days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650)) {
        return fail(res, 400, 'days harus integer 1-3650 atau null untuk penangguhan permanen.');
    }
    if (id === adminId) return fail(res, 400, 'Anda tidak dapat menangguhkan akun sendiri.');

    const [target] = await db.select({ id: user_table.id, role: user_table.role })
        .from(user_table).where(eq(user_table.id, id)).limit(1);
    if (!target) return fail(res, 404, 'Pengguna tidak ditemukan.');
    if (target.role === 'ADMIN') return fail(res, 403, 'Akun admin tidak dapat ditangguhkan.');

    const suspendedUntil = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

    await db.transaction(async (tx) => {
        await tx.update(user_table).set({
            status: 'SUSPENDED',
            suspended_until: suspendedUntil,
            suspended_reason: reason,
            updated_at: new Date(),
        }).where(eq(user_table.id, id));

        // Revoke sessions so the suspension takes effect immediately.
        await tx.update(refresh_token_table)
            .set({ revoked_at: new Date() })
            .where(and(eq(refresh_token_table.user_id, id), isNull(refresh_token_table.revoked_at)));

        await notify(tx, id, {
            type: 'account.suspended',
            title: 'Akun ditangguhkan',
            body: reason,
            data: { suspended_until: suspendedUntil },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: 'user.suspend',
            entityType: 'user',
            entityId: id,
            metadata: { days: days ?? null, reason },
        });
    });

    return ok(res, 'Akun berhasil ditangguhkan', {
        id, status: 'SUSPENDED', suspended_until: suspendedUntil,
    });
};

export const reactivateUser = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID user tidak valid.');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return fail(res, 400, 'reason wajib diisi.');

    const [target] = await db.select({ id: user_table.id })
        .from(user_table).where(eq(user_table.id, id)).limit(1);
    if (!target) return fail(res, 404, 'Pengguna tidak ditemukan.');

    await db.transaction(async (tx) => {
        await tx.update(user_table).set({
            status: 'ACTIVE',
            suspended_until: null,
            suspended_reason: null,
            updated_at: new Date(),
        }).where(eq(user_table.id, id));

        await notify(tx, id, {
            type: 'account.reactivated',
            title: 'Akun diaktifkan kembali',
            body: 'Akun Anda telah diaktifkan kembali. Silakan login.',
            data: {},
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: 'user.reactivate',
            entityType: 'user',
            entityId: id,
            metadata: { reason },
        });
    });

    return ok(res, 'Akun berhasil diaktifkan kembali', { id, status: 'ACTIVE' });
};

export const warnUser = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID user tidak valid.');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) return fail(res, 400, 'note wajib diisi.');

    const [target] = await db.select({ id: user_table.id })
        .from(user_table).where(eq(user_table.id, id)).limit(1);
    if (!target) return fail(res, 404, 'Pengguna tidak ditemukan.');

    await db.transaction(async (tx) => {
        await notify(tx, id, {
            type: 'account.warning',
            title: 'Peringatan dari admin',
            body: note,
            data: { admin_id: adminId },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: 'user.warn',
            entityType: 'user',
            entityId: id,
            metadata: { note },
        });
    });

    return ok(res, 'Peringatan berhasil dikirim', { id, warned: true });
};

export const exportUsers = async (_req: Request, res: Response) => {
    const rows = await db.select({
        id: user_table.id,
        full_name: user_table.full_name,
        email: user_table.email,
        university: user_table.university,
        major: user_table.major,
        role: user_table.role,
        status: user_table.status,
        created_at: user_table.created_at,
    }).from(user_table).orderBy(desc(user_table.created_at));

    return sendCsv(res, 'users.csv', toCsv(rows));
};
