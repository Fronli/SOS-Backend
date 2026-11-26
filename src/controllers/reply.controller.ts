import { Request, Response } from 'express';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/db';
import {
    assignment_table, reply_table, request_table, user_table,
} from '../db/schema';
import { recordAudit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { isBlockedPair, getUserSkills } from '../services/user.service';
import { publicUrl } from '../services/storage.service';
import { fail, ok, paginated } from '../utils/response.util';
import { parseId } from '../utils/id.util';
import { parsePagination } from '../utils/pagination.util';

export const listReplies = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID request tidak valid.');

    const [request] = await db.select({ id: request_table.id, deleted_at: request_table.deleted_at })
        .from(request_table).where(eq(request_table.id, id)).limit(1);
    if (!request || request.deleted_at) return fail(res, 404, 'Request tidak ditemukan.');

    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

    const [countRow] = await db
        .select({ total: count() })
        .from(reply_table)
        .where(and(eq(reply_table.request_id, id), isNull(reply_table.deleted_at)));

    const rows = await db
        .select({
            id: reply_table.id,
            message: reply_table.message,
            created_at: reply_table.created_at,
            helper: {
                id: user_table.id,
                full_name: user_table.full_name,
                university: user_table.university,
                major: user_table.major,
                avatar_file_key: user_table.avatar_file_key,
                student_verified_at: user_table.student_verified_at,
            },
        })
        .from(reply_table)
        .innerJoin(user_table, eq(reply_table.helper_id, user_table.id))
        .where(and(eq(reply_table.request_id, id), isNull(reply_table.deleted_at)))
        .orderBy(desc(reply_table.created_at), desc(reply_table.id))
        .limit(limit)
        .offset(offset);

    const data = await Promise.all(rows.map(async ({ helper, ...rest }) => ({
        ...rest,
        helper: {
            ...helper,
            avatar_url: helper.avatar_file_key ? publicUrl(helper.avatar_file_key) : null,
            is_student_verified: Boolean(helper.student_verified_at),
        },
    })));

    return paginated(res, 'Daftar reply berhasil diambil', data, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

export const createReply = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID request tidak valid.');

    const [request] = await db.select().from(request_table).where(eq(request_table.id, id)).limit(1);
    if (!request || request.deleted_at) return fail(res, 404, 'Request tidak ditemukan.');
    if (request.requester_id === userId) {
        return fail(res, 400, 'Anda tidak dapat memberi reply pada request sendiri.');
    }
    if (request.status !== 'OPEN') {
        return fail(res, 409, 'Request ini sudah tidak menerima reply.');
    }
    if (await isBlockedPair(userId, request.requester_id)) {
        return fail(res, 403, 'Tidak dapat mengirim reply karena pengguna ini diblokir.');
    }

    const [existing] = await db
        .select({ id: reply_table.id })
        .from(reply_table)
        .where(and(
            eq(reply_table.request_id, id),
            eq(reply_table.helper_id, userId),
            isNull(reply_table.deleted_at),
        ))
        .limit(1);
    if (existing) return fail(res, 409, 'Anda sudah mengirim reply pada request ini.');

    const message: string = req.body.message;

    const reply = await db.transaction(async (tx) => {
        const [created] = await tx.insert(reply_table).values({
            request_id: id,
            helper_id: userId,
            message,
        }).returning();

        const [helper] = await tx.select({ full_name: user_table.full_name })
            .from(user_table).where(eq(user_table.id, userId)).limit(1);

        await notify(tx, request.requester_id, {
            type: 'request.reply',
            title: 'Reply baru pada request Anda',
            body: `${helper?.full_name ?? 'Seorang helper'} menawarkan bantuan pada "${request.title}".`,
            data: { request_id: id, reply_id: created.id, helper_id: userId },
        });
        await recordAudit(tx, {
            actorId: userId,
            action: 'reply.create',
            entityType: 'request',
            entityId: id,
            metadata: { reply_id: created.id },
        });

        return created;
    });

    return res.status(201).json({
        success: true,
        message: 'Reply berhasil dikirim',
        data: reply,
    });
};

export const deleteReply = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID reply tidak valid.');

    const [existing] = await db.select()
        .from(reply_table)
        .where(and(eq(reply_table.id, id), isNull(reply_table.deleted_at)))
        .limit(1);

    if (!existing) return fail(res, 404, 'Reply tidak ditemukan.');
    if (existing.helper_id !== userId) return fail(res, 403, 'Anda tidak memiliki akses untuk menghapus reply ini.');

    const [assignment] = await db
        .select({ id: assignment_table.id })
        .from(assignment_table)
        .where(and(
            eq(assignment_table.request_id, existing.request_id),
            eq(assignment_table.helper_id, userId),
        ))
        .limit(1);

    if (assignment) {
        return fail(res, 409, 'Reply tidak dapat ditarik karena sudah ada assignment.');
    }

    await db.update(reply_table)
        .set({ deleted_at: new Date() })
        .where(eq(reply_table.id, id));

    return res.status(204).send();
};
