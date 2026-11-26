import { Request, Response } from 'express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/db';
import {
    file_table, portfolio_table, student_verification_table,
    tag_table, user_interest_table, user_skill_table, user_table,
} from '../db/schema';
import { recordAudit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { publicUrl, signedUrl } from '../services/storage.service';
import { serializePrivateProfile } from '../services/user.service';
import { fail, ok } from '../utils/response.util';
import { parseId } from '../utils/id.util';

async function validateTagIds(ids: number[]): Promise<number[] | null> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await db.select({ id: tag_table.id }).from(tag_table).where(inArray(tag_table.id, unique));
    if (rows.length !== unique.length) return null;
    return unique;
}

async function replaceUserTags(
    table: typeof user_interest_table | typeof user_skill_table,
    userId: number,
    tagIds: number[],
) {
    await db.transaction(async (tx) => {
        await tx.delete(table).where(eq(table.user_id, userId));
        if (tagIds.length > 0) {
            await tx.insert(table).values(tagIds.map((tagId) => ({ user_id: userId, tag_id: tagId })));
        }
    });
}

export const getMe = async (req: Request, res: Response) => {
    const profile = await serializePrivateProfile(req.user!.id);
    if (!profile) return fail(res, 404, 'Akun tidak ditemukan.');
    return ok(res, 'Profil berhasil diambil', profile);
};

export const updateMe = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const body = req.body as Record<string, unknown>;

    if (Object.keys(body).length === 0) {
        return fail(res, 400, 'Tidak ada field yang dikirim untuk diperbarui.');
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const key of ['full_name', 'university', 'major'] as const) {
        if (key in body) updates[key] = body[key];
    }
    for (const key of ['linkedin_url', 'website'] as const) {
        if (key in body) updates[key] = body[key] ?? null;
    }

    await db.update(user_table).set(updates).where(eq(user_table.id, userId));
    const profile = await serializePrivateProfile(userId);
    return ok(res, 'Profil berhasil diperbarui', profile);
};

export const putInterests = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const ids = await validateTagIds(req.body.tag_ids);
    if (ids === null) return fail(res, 400, 'Sebagian tag_id tidak ditemukan.');

    await replaceUserTags(user_interest_table, userId, ids);
    const profile = await serializePrivateProfile(userId);
    return ok(res, 'Bidang minat berhasil disimpan', { interests: profile?.interests ?? [] });
};

export const putSkills = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const ids = await validateTagIds(req.body.tag_ids);
    if (ids === null) return fail(res, 400, 'Sebagian tag_id tidak ditemukan.');

    await replaceUserTags(user_skill_table, userId, ids);
    const profile = await serializePrivateProfile(userId);
    return ok(res, 'Skills berhasil disimpan', { skills: profile?.skills ?? [] });
};

export const uploadAvatar = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { file_key } = req.body as { file_key: string };

    const [file] = await db.select().from(file_table)
        .where(and(eq(file_table.key, file_key), eq(file_table.owner_id, userId)))
        .limit(1);

    if (!file) return fail(res, 404, 'File tidak ditemukan.');
    if (file.purpose !== 'AVATAR') return fail(res, 400, 'File bukan untuk avatar.');
    if (file.status !== 'UPLOADED') return fail(res, 400, 'File belum diunggah.');

    await db.update(user_table)
        .set({ avatar_file_key: file.key, updated_at: new Date() })
        .where(eq(user_table.id, userId));

    return ok(res, 'Foto profil berhasil diperbarui', { avatar_url: publicUrl(file.key) });
};

export const createPortfolio = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const body = req.body as {
        title: string; description?: string | null; url?: string | null;
        file_key?: string | null; sort_order?: number;
    };

    if (body.file_key) {
        const [file] = await db.select({ id: file_table.id, status: file_table.status, purpose: file_table.purpose })
            .from(file_table)
            .where(and(eq(file_table.key, body.file_key), eq(file_table.owner_id, userId)))
            .limit(1);
        if (!file) return fail(res, 404, 'File portfolio tidak ditemukan.');
        if (file.status !== 'UPLOADED') return fail(res, 400, 'File belum diunggah.');
        if (file.purpose !== 'PORTFOLIO') return fail(res, 400, 'File bukan untuk portfolio.');
    }

    const [row] = await db.insert(portfolio_table).values({
        user_id: userId,
        title: body.title,
        description: body.description ?? null,
        url: body.url ?? null,
        file_key: body.file_key ?? null,
        sort_order: body.sort_order ?? 0,
    }).returning();

    return res.status(201).json({
        success: true,
        message: 'Portfolio berhasil ditambahkan',
        data: { ...row, file_url: row.file_key ? publicUrl(row.file_key) : null },
    });
};

export const deletePortfolio = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID portfolio tidak valid.');

    const [existing] = await db.select({ id: portfolio_table.id, user_id: portfolio_table.user_id })
        .from(portfolio_table)
        .where(and(eq(portfolio_table.id, id), isNull(portfolio_table.deleted_at)))
        .limit(1);

    if (!existing) return fail(res, 404, 'Portfolio tidak ditemukan.');
    if (existing.user_id !== userId) return fail(res, 403, 'Anda tidak memiliki akses.');

    await db.update(portfolio_table)
        .set({ deleted_at: new Date() })
        .where(eq(portfolio_table.id, id));

    return res.status(204).send();
};

export const submitStudentVerification = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { file_key } = req.body as { file_key: string };

    const [file] = await db.select().from(file_table)
        .where(and(eq(file_table.key, file_key), eq(file_table.owner_id, userId)))
        .limit(1);
    if (!file) return fail(res, 404, 'File KTM tidak ditemukan.');
    if (file.purpose !== 'STUDENT_ID') return fail(res, 400, 'File bukan untuk verifikasi KTM.');
    if (file.status !== 'UPLOADED') return fail(res, 400, 'File belum diunggah.');

    const [existing] = await db.select({ id: student_verification_table.id })
        .from(student_verification_table)
        .where(and(
            eq(student_verification_table.user_id, userId),
            inArray(student_verification_table.status, ['PENDING', 'IN_REVIEW']),
        ))
        .limit(1);

    if (existing) {
        return fail(res, 409, 'Pengajuan verifikasi KTM sedang diproses.', {
            verification_id: existing.id,
        });
    }

    const [row] = await db.transaction(async (tx) => {
        const [created] = await tx.insert(student_verification_table).values({
            user_id: userId,
            file_key,
        }).returning();
        await recordAudit(tx, {
            actorId: userId,
            action: 'student_verification.submit',
            entityType: 'student_verification',
            entityId: created.id,
        });
        return [created];
    });

    return res.status(201).json({
        success: true,
        message: 'Pengajuan verifikasi KTM diterima dan menunggu peninjauan admin.',
        data: { id: row.id, status: row.status, created_at: row.created_at },
    });
};

export const getStudentVerification = async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const [latest] = await db.select().from(student_verification_table)
        .where(eq(student_verification_table.user_id, userId))
        .orderBy(sql`${student_verification_table.created_at} DESC`)
        .limit(1);

    const [user] = await db.select({ student_verified_at: user_table.student_verified_at })
        .from(user_table).where(eq(user_table.id, userId)).limit(1);

    if (!latest) {
        return ok(res, 'Belum ada pengajuan verifikasi KTM', {
            is_verified: Boolean(user?.student_verified_at),
            verification: null,
        });
    }

    return ok(res, 'Status verifikasi KTM berhasil diambil', {
        is_verified: Boolean(user?.student_verified_at),
        verification: {
            id: latest.id,
            status: latest.status,
            note: latest.note,
            created_at: latest.created_at,
            reviewed_at: latest.reviewed_at,
            file_url: latest.status === 'APPROVED' ? publicUrl(latest.file_key) : signedUrl(latest.file_key),
        },
    });
};
