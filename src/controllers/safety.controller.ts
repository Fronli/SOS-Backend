import { Request, Response } from 'express';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/db';
import { block_table, report_table, request_table, user_table } from '../db/schema';
import { recordAudit } from '../services/audit.service';
import { publicUrl } from '../services/storage.service';
import { fail, ok } from '../utils/response.util';
import { parseId } from '../utils/id.util';

/** POST /reports — report a request or a user. */
export const createReport = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { target_type: targetType, target_id: targetId, reason } = req.body as {
        target_type: 'REQUEST' | 'USER';
        target_id: number;
        reason: string;
    };

    if (targetType === 'USER' && targetId === userId) {
        return fail(res, 400, 'Anda tidak dapat melaporkan diri sendiri.');
    }

    if (targetType === 'REQUEST') {
        const [request] = await db.select({ id: request_table.id })
            .from(request_table)
            .where(and(eq(request_table.id, targetId), isNull(request_table.deleted_at)))
            .limit(1);
        if (!request) return fail(res, 404, 'Request yang dilaporkan tidak ditemukan.');
    } else {
        const [user] = await db.select({ id: user_table.id })
            .from(user_table).where(eq(user_table.id, targetId)).limit(1);
        if (!user) return fail(res, 404, 'Pengguna yang dilaporkan tidak ditemukan.');
    }

    const [existing] = await db.select({ id: report_table.id })
        .from(report_table)
        .where(and(
            eq(report_table.reporter_id, userId),
            eq(report_table.target_type, targetType),
            eq(report_table.target_id, targetId),
            inArray(report_table.status, ['OPEN', 'IN_REVIEW']),
        ))
        .limit(1);

    if (existing) {
        return fail(res, 409, 'Anda sudah melaporkan ini dan laporan masih diproses.', {
            report_id: existing.id,
        });
    }

    const report = await db.transaction(async (tx) => {
        const [created] = await tx.insert(report_table).values({
            reporter_id: userId,
            target_type: targetType,
            target_id: targetId,
            reason,
            status: 'OPEN',
        }).returning();

        await recordAudit(tx, {
            actorId: userId,
            action: 'report.create',
            entityType: targetType.toLowerCase(),
            entityId: targetId,
            metadata: { report_id: created.id },
        });
        return created;
    });

    return res.status(201).json({
        success: true,
        message: 'Laporan diterima dan akan ditinjau admin.',
        data: { id: report.id, status: report.status, created_at: report.created_at },
    });
};

/** POST /blocks */
export const blockUser = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const targetId = parseId(req.body?.user_id);
    if (!targetId) return fail(res, 400, 'user_id tidak valid.');
    if (targetId === userId) return fail(res, 400, 'Anda tidak dapat memblokir diri sendiri.');

    const [target] = await db.select({ id: user_table.id })
        .from(user_table).where(eq(user_table.id, targetId)).limit(1);
    if (!target) return fail(res, 404, 'Pengguna tidak ditemukan.');

    await db.insert(block_table).values({ blocker_id: userId, blocked_id: targetId })
        .onConflictDoNothing();

    await recordAudit(db, {
        actorId: userId,
        action: 'block.create',
        entityType: 'user',
        entityId: targetId,
    });

    return res.status(201).json({
        success: true,
        message: 'Pengguna berhasil diblokir',
        data: { blocked_user_id: targetId },
    });
};

/** DELETE /blocks/:userId */
export const unblockUser = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const targetId = parseId(req.params.userId);
    if (!targetId) return fail(res, 400, 'ID user tidak valid.');

    const deleted = await db.delete(block_table)
        .where(and(eq(block_table.blocker_id, userId), eq(block_table.blocked_id, targetId)))
        .returning({ blocked_id: block_table.blocked_id });

    if (deleted.length === 0) return fail(res, 404, 'Blokir tidak ditemukan.');

    await recordAudit(db, {
        actorId: userId,
        action: 'block.remove',
        entityType: 'user',
        entityId: targetId,
    });

    return res.status(204).send();
};

/** GET /blocks — list users the caller has blocked. */
export const listBlocks = async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const rows = await db
        .select({
            id: user_table.id,
            full_name: user_table.full_name,
            university: user_table.university,
            avatar_file_key: user_table.avatar_file_key,
            created_at: block_table.created_at,
        })
        .from(block_table)
        .innerJoin(user_table, eq(block_table.blocked_id, user_table.id))
        .where(eq(block_table.blocker_id, userId));

    return ok(res, 'Daftar blokir berhasil diambil', rows.map(({ avatar_file_key, ...rest }) => ({
        ...rest,
        avatar_url: avatar_file_key ? publicUrl(avatar_file_key) : null,
    })));
};
