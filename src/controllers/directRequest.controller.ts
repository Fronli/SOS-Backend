import { Request, Response } from 'express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/db';
import {
    conversation_table, message_table, request_table, request_tag_table,
    tag_table, user_table,
} from '../db/schema';
import { recordAudit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { isBlockedPair } from '../services/user.service';
import { fail } from '../utils/response.util';
import { parseId } from '../utils/id.util';

/**
 * POST /helpers/:id/direct-requests — creates a request addressed to one helper
 * and opens the conversation with an optional opening message.
 */
export const createDirectRequest = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const helperId = parseId(req.params.id);
    if (!helperId) return fail(res, 400, 'ID helper tidak valid.');
    if (helperId === userId) return fail(res, 400, 'Anda tidak dapat membuat direct request untuk diri sendiri.');

    const [helper] = await db.select({ id: user_table.id, status: user_table.status, full_name: user_table.full_name })
        .from(user_table).where(eq(user_table.id, helperId)).limit(1);
    if (!helper || helper.status !== 'ACTIVE') return fail(res, 404, 'Helper tidak ditemukan atau tidak aktif.');

    if (await isBlockedPair(userId, helperId)) {
        return fail(res, 403, 'Tidak dapat membuat direct request karena pengguna ini diblokir.');
    }

    const body = req.body as {
        request_id?: number;
        title?: string;
        description?: string;
        message?: string;
        estimated_time?: 'fast' | 'moderate' | 'extended';
        deadline_at?: string;
        budget_amount?: number;
        tag_ids?: number[];
    };

    // Reuse an existing request when request_id is given.
    let requestId: number;
    if (body.request_id) {
        const [existing] = await db.select()
            .from(request_table)
            .where(and(eq(request_table.id, body.request_id), isNull(request_table.deleted_at)))
            .limit(1);
        if (!existing) return fail(res, 404, 'Request tidak ditemukan.');
        if (existing.requester_id !== userId) {
            return fail(res, 403, 'Anda bukan pemilik request ini.');
        }
        requestId = existing.id;
    } else {
        if (!body.title || !body.description || !body.estimated_time || !body.deadline_at
            || body.budget_amount === undefined || !Array.isArray(body.tag_ids) || body.tag_ids.length === 0) {
            return fail(res, 400, 'title, description, estimated_time, deadline_at, budget_amount, dan tag_ids wajib diisi.');
        }

        const tagIds = [...new Set(body.tag_ids)];
        if (tagIds.length === 0) return fail(res, 400, 'tag_ids wajib diisi.');

        const tags = await db.select({ id: tag_table.id }).from(tag_table)
            .where(inArray(tag_table.id, tagIds));
        if (tags.length !== tagIds.length) {
            return fail(res, 400, 'Sebagian tag tidak ditemukan.');
        }

        const created = await db.transaction(async (tx) => {
            const [request] = await tx.insert(request_table).values({
                requester_id: userId,
                title: body.title!,
                description: body.description!,
                estimated_time: body.estimated_time!,
                deadline_at: new Date(body.deadline_at!),
                budget_amount: body.budget_amount!,
                status: 'OPEN',
            }).returning();

            await tx.insert(request_tag_table).values(
                tagIds.map((tagId) => ({ request_id: request.id, tag_id: tagId })),
            );
            return request;
        });
        requestId = created.id;
    }

    const conversation = await db.transaction(async (tx) => {
        await tx.insert(conversation_table).values({
            request_id: requestId,
            requester_id: userId,
            helper_id: helperId,
            status: 'ACTIVE',
        }).onConflictDoNothing({ target: [conversation_table.request_id, conversation_table.helper_id] });

        const [row] = await tx.select().from(conversation_table)
            .where(and(
                eq(conversation_table.request_id, requestId),
                eq(conversation_table.helper_id, helperId),
            ))
            .limit(1);

        if (body.message) {
            const [message] = await tx.insert(message_table).values({
                conversation_id: row.id,
                sender_id: userId,
                body: body.message,
            }).returning();
            await tx.update(conversation_table)
                .set({ last_message_at: message.created_at, last_message_preview: body.message.slice(0, 160) })
                .where(eq(conversation_table.id, row.id));
        }

        await notify(tx, helperId, {
            type: 'request.direct',
            title: 'Direct request baru',
            body: `${helper.full_name}, Anda menerima direct request.`,
            data: { request_id: requestId, conversation_id: row.id },
        });
        await recordAudit(tx, {
            actorId: userId,
            action: 'request.direct_create',
            entityType: 'request',
            entityId: requestId,
            metadata: { helper_id: helperId, conversation_id: row.id },
        });
        return row;
    });

    return res.status(201).json({
        success: true,
        message: 'Direct request berhasil dibuat',
        data: { request_id: requestId, conversation_id: conversation.id },
    });
};
