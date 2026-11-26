import { Request, Response } from 'express';
import { and, count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../db/db';
import { student_verification_table, user_table } from '../../db/schema';
import { recordAudit } from '../../services/audit.service';
import { notify } from '../../services/notification.service';
import { signedUrl } from '../../services/storage.service';
import { fail, ok, paginated } from '../../utils/response.util';
import { parseId } from '../../utils/id.util';
import { parsePagination } from '../../utils/pagination.util';
import { sendCsv, toCsv } from '../../utils/csv.util';
import { enumValue } from '../../utils/enum.util';

export const listVerifications = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const status = enumValue(['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED'] as const, req.query.status);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const filters = [];
    if (status) filters.push(eq(student_verification_table.status, status));
    if (q) {
        const escaped = q.replace(/[%_\\]/g, '\\$&');
        filters.push(or(
            ilike(user_table.full_name, `%${escaped}%`),
            ilike(user_table.email, `%${escaped}%`),
            ilike(user_table.university, `%${escaped}%`),
        )!);
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const base = db
        .select({
            id: student_verification_table.id,
            status: student_verification_table.status,
            created_at: student_verification_table.created_at,
            reviewed_at: student_verification_table.reviewed_at,
            user: {
                id: user_table.id,
                full_name: user_table.full_name,
                email: user_table.email,
                university: user_table.university,
                major: user_table.major,
            },
        })
        .from(student_verification_table)
        .innerJoin(user_table, eq(student_verification_table.user_id, user_table.id))
        .$dynamic();

    const countBase = db
        .select({ total: count() })
        .from(student_verification_table)
        .innerJoin(user_table, eq(student_verification_table.user_id, user_table.id))
        .$dynamic();

    const [countRow] = await (whereClause ? countBase.where(whereClause) : countBase);
    const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(student_verification_table.created_at))
        .limit(limit)
        .offset(offset);

    return paginated(res, 'Antrean verifikasi berhasil diambil', rows, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

export const getVerification = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID verifikasi tidak valid.');

    const [row] = await db
        .select({
            id: student_verification_table.id,
            status: student_verification_table.status,
            note: student_verification_table.note,
            file_key: student_verification_table.file_key,
            created_at: student_verification_table.created_at,
            claimed_at: student_verification_table.claimed_at,
            reviewed_at: student_verification_table.reviewed_at,
            reviewer_id: student_verification_table.reviewer_id,
            user: {
                id: user_table.id,
                full_name: user_table.full_name,
                email: user_table.email,
                university: user_table.university,
                major: user_table.major,
                student_verified_at: user_table.student_verified_at,
            },
        })
        .from(student_verification_table)
        .innerJoin(user_table, eq(student_verification_table.user_id, user_table.id))
        .where(eq(student_verification_table.id, id))
        .limit(1);

    if (!row) return fail(res, 404, 'Verifikasi tidak ditemukan.');

    return ok(res, 'Detail verifikasi berhasil diambil', {
        ...row,
        document_url: signedUrl(row.file_key),
        document_preview_url: signedUrl(row.file_key, 15 * 60),
    });
};

export const claimVerification = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID verifikasi tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(student_verification_table)
            .where(eq(student_verification_table.id, id)).for('update');
        if (!row) return { error: true as const, status: 404, message: 'Verifikasi tidak ditemukan.' };
        if (row.status === 'IN_REVIEW' && row.reviewer_id === adminId) {
            return { error: false as const, row };
        }
        if (row.status !== 'PENDING') {
            return { error: true as const, status: 409, message: 'Verifikasi ini tidak dapat diklaim.' };
        }

        const [updated] = await tx.update(student_verification_table)
            .set({ status: 'IN_REVIEW', reviewer_id: adminId, claimed_at: new Date() })
            .where(eq(student_verification_table.id, id)).returning();

        await recordAudit(tx, {
            actorId: adminId,
            action: 'verification.claim',
            entityType: 'student_verification',
            entityId: id,
        });
        return { error: false as const, row: updated };
    });

    if (result.error) return fail(res, result.status, result.message);
    return ok(res, 'Verifikasi ditandai sedang ditinjau', {
        id: result.row.id,
        status: result.row.status,
        claimed_at: result.row.claimed_at,
    });
};

export const approveVerification = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID verifikasi tidak valid.');
    const note = typeof req.body?.note === 'string' ? req.body.note : null;

    const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(student_verification_table)
            .where(eq(student_verification_table.id, id)).for('update');
        if (!row) return { error: true as const, status: 404, message: 'Verifikasi tidak ditemukan.' };
        if (row.status === 'APPROVED') {
            return { error: true as const, status: 409, message: 'Verifikasi sudah disetujui.' };
        }
        if (row.status === 'REJECTED') {
            return { error: true as const, status: 409, message: 'Verifikasi sudah ditolak.' };
        }

        const now = new Date();
        await tx.update(student_verification_table)
            .set({ status: 'APPROVED', note, reviewer_id: adminId, reviewed_at: now })
            .where(eq(student_verification_table.id, id));
        await tx.update(user_table)
            .set({ student_verified_at: now, updated_at: now })
            .where(eq(user_table.id, row.user_id));

        await notify(tx, row.user_id, {
            type: 'verification.approved',
            title: 'Verifikasi mahasiswa disetujui',
            body: note || 'KTM Anda telah diverifikasi. Status mahasiswa aktif di profil Anda.',
            data: { verification_id: id },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: 'verification.approve',
            entityType: 'student_verification',
            entityId: id,
            metadata: { user_id: row.user_id, note },
        });
        return { error: false as const };
    });

    if (result.error) return fail(res, result.status, result.message);
    return ok(res, 'Verifikasi disetujui', { id, status: 'APPROVED' });
};

export const rejectVerification = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID verifikasi tidak valid.');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) return fail(res, 400, 'note wajib diisi untuk menolak verifikasi.');

    const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(student_verification_table)
            .where(eq(student_verification_table.id, id)).for('update');
        if (!row) return { error: true as const, status: 404, message: 'Verifikasi tidak ditemukan.' };
        if (row.status === 'APPROVED') {
            return { error: true as const, status: 409, message: 'Verifikasi yang sudah disetujui tidak dapat ditolak.' };
        }

        const now = new Date();
        await tx.update(student_verification_table)
            .set({ status: 'REJECTED', note, reviewer_id: adminId, reviewed_at: now })
            .where(eq(student_verification_table.id, id));

        await notify(tx, row.user_id, {
            type: 'verification.rejected',
            title: 'Verifikasi mahasiswa ditolak',
            body: note,
            data: { verification_id: id },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: 'verification.reject',
            entityType: 'student_verification',
            entityId: id,
            metadata: { user_id: row.user_id, note },
        });
        return { error: false as const };
    });

    if (result.error) return fail(res, result.status, result.message);
    return ok(res, 'Verifikasi ditolak', { id, status: 'REJECTED' });
};

export const exportVerifications = async (_req: Request, res: Response) => {
    const rows = await db
        .select({
            id: student_verification_table.id,
            user_email: user_table.email,
            user_name: user_table.full_name,
            university: user_table.university,
            major: user_table.major,
            status: student_verification_table.status,
            created_at: student_verification_table.created_at,
            reviewed_at: student_verification_table.reviewed_at,
        })
        .from(student_verification_table)
        .innerJoin(user_table, eq(student_verification_table.user_id, user_table.id))
        .orderBy(desc(student_verification_table.created_at));

    return sendCsv(res, 'verifications.csv', toCsv(rows));
};
