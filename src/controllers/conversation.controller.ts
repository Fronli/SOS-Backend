import { Request, Response } from 'express';
import { and, count, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/db';
import {
    assignment_table, conversation_read_table, conversation_table, file_table,
    message_table, request_table, user_table,
} from '../db/schema';
import { recordAudit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { isBlockedPair } from '../services/user.service';
import { publicUrl } from '../services/storage.service';
import { fail, ok, paginated } from '../utils/response.util';
import { parseId } from '../utils/id.util';
import { parsePagination } from '../utils/pagination.util';

type Participant = { id: number; full_name: string; avatar_file_key: string | null };

function person(row: Participant | null) {
    if (!row) return null;
    return {
        id: row.id,
        full_name: row.full_name,
        avatar_url: row.avatar_file_key ? publicUrl(row.avatar_file_key) : null,
    };
}

/** Loads a conversation only when the caller participates in it. */
async function loadConversationForUser(conversationId: number, userId: number) {
    const [row] = await db
        .select()
        .from(conversation_table)
        .where(eq(conversation_table.id, conversationId))
        .limit(1);

    if (!row) return { error: 'not_found' as const, conversation: null };
    if (row.requester_id !== userId && row.helper_id !== userId) {
        return { error: 'forbidden' as const, conversation: null };
    }
    return { error: null, conversation: row };
}

async function conversationAssignment(conversation: { request_id: number; helper_id: number }) {
    const [row] = await db
        .select({
            id: assignment_table.id,
            status: assignment_table.status,
            amount: assignment_table.amount,
            helper_id: assignment_table.helper_id,
            requester_id: assignment_table.requester_id,
        })
        .from(assignment_table)
        .where(and(
            eq(assignment_table.request_id, conversation.request_id),
            eq(assignment_table.helper_id, conversation.helper_id),
        ))
        .orderBy(desc(assignment_table.created_at))
        .limit(1);
    return row ?? null;
}

async function unreadCount(conversationId: number, userId: number) {
    const [read] = await db
        .select({ last_read_message_id: conversation_read_table.last_read_message_id })
        .from(conversation_read_table)
        .where(and(
            eq(conversation_read_table.conversation_id, conversationId),
            eq(conversation_read_table.user_id, userId),
        ))
        .limit(1);

    const lastRead = read?.last_read_message_id ?? 0;
    const [row] = await db
        .select({ total: count() })
        .from(message_table)
        .where(and(
            eq(message_table.conversation_id, conversationId),
            sql`${message_table.sender_id} <> ${userId}`,
            sql`${message_table.id} > ${lastRead}`,
        ));
    return Number(row?.total ?? 0);
}

/**
 * GET /conversations — chat list with last message, newest activity first.
 */
export const listConversations = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const conditions = [or(
        eq(conversation_table.requester_id, userId),
        eq(conversation_table.helper_id, userId),
    )!];

    if (q) {
        const escaped = q.replace(/[%_\\]/g, '\\$&');
        conditions.push(ilike(conversation_table.last_message_preview, `%${escaped}%`));
    }

    const whereClause = and(...conditions)!;

    const [countRow] = await db.select({ total: count() }).from(conversation_table).where(whereClause);

    const rows = await db
        .select({
            id: conversation_table.id,
            request_id: conversation_table.request_id,
            requester_id: conversation_table.requester_id,
            helper_id: conversation_table.helper_id,
            status: conversation_table.status,
            last_message_at: conversation_table.last_message_at,
            last_message_preview: conversation_table.last_message_preview,
            created_at: conversation_table.created_at,
            request_title: request_table.title,
        })
        .from(conversation_table)
        .innerJoin(request_table, eq(conversation_table.request_id, request_table.id))
        .where(whereClause)
        .orderBy(desc(sql`COALESCE(${conversation_table.last_message_at}, ${conversation_table.created_at})`))
        .limit(limit)
        .offset(offset);

    const data = await Promise.all(rows.map(async (row) => {
        const counterpartId = row.requester_id === userId ? row.helper_id : row.requester_id;
        const [counterpart] = await db
            .select({
                id: user_table.id,
                full_name: user_table.full_name,
                avatar_file_key: user_table.avatar_file_key,
            })
            .from(user_table)
            .where(eq(user_table.id, counterpartId))
            .limit(1);

        const [unread, assignment] = await Promise.all([
            unreadCount(row.id, userId),
            conversationAssignment({ request_id: row.request_id, helper_id: row.helper_id }),
        ]);

        return {
            id: row.id,
            request: { id: row.request_id, title: row.request_title },
            counterpart: person(counterpart ?? null),
            status: row.status,
            last_message_preview: row.last_message_preview,
            last_message_at: row.last_message_at ?? row.created_at,
            unread_count: unread,
            assignment: assignment ? { id: assignment.id, status: assignment.status } : null,
        };
    }));

    return paginated(res, 'Daftar chat berhasil diambil', data, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

/**
 * POST /conversations — get or create a conversation between requester and helper.
 */
export const createConversation = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { request_id: requestId, helper_id: helperId } = req.body as {
        request_id: number;
        helper_id: number;
    };

    if (userId === helperId) {
        return fail(res, 400, 'Anda tidak dapat memulai chat dengan diri sendiri.');
    }

    const [request] = await db.select().from(request_table)
      .where(eq(request_table.id, requestId)).limit(1);
    if (!request || request.deleted_at) return fail(res, 404, 'Request tidak ditemukan.');
    if (request.requester_id !== userId) {
        return fail(res, 403, 'Hanya pembuat request yang dapat memulai percakapan.');
    }
    if (await isBlockedPair(userId, helperId)) {
        return fail(res, 403, 'Tidak dapat memulai chat karena pengguna ini diblokir.');
    }

    const [helper] = await db.select({ id: user_table.id, status: user_table.status })
        .from(user_table).where(eq(user_table.id, helperId)).limit(1);
    if (!helper || helper.status !== 'ACTIVE') return fail(res, 404, 'Helper tidak ditemukan.');

    const [existing] = await db.select().from(conversation_table)
        .where(and(
            eq(conversation_table.request_id, requestId),
            eq(conversation_table.helper_id, helperId),
        ))
        .limit(1);

    if (existing) {
        return ok(res, 'Percakapan ditemukan', await conversationDetail(existing.id, userId));
    }

    const [created] = await db.insert(conversation_table).values({
        request_id: requestId,
        requester_id: request.requester_id,
        helper_id: helperId,
        status: 'ACTIVE',
    }).returning();

    return res.status(201).json({
        success: true,
        message: 'Percakapan berhasil dibuat',
        data: await conversationDetail(created.id, userId),
    });
};

async function conversationDetail(conversationId: number, userId: number) {
    const [row] = await db.select().from(conversation_table)
        .where(eq(conversation_table.id, conversationId)).limit(1);
    if (!row) return null;

    const [requester] = await db.select({
        id: user_table.id, full_name: user_table.full_name, avatar_file_key: user_table.avatar_file_key,
    }).from(user_table).where(eq(user_table.id, row.requester_id)).limit(1);

    const [helper] = await db.select({
        id: user_table.id, full_name: user_table.full_name, avatar_file_key: user_table.avatar_file_key,
    }).from(user_table).where(eq(user_table.id, row.helper_id)).limit(1);

    const [request] = await db.select({ id: request_table.id, title: request_table.title, status: request_table.status })
        .from(request_table).where(eq(request_table.id, row.request_id)).limit(1);

    const [assignment, unread] = await Promise.all([
        conversationAssignment({ request_id: row.request_id, helper_id: row.helper_id }),
        unreadCount(conversationId, userId),
    ]);

    return {
        id: row.id,
        request,
        requester: person(requester ?? null),
        helper: person(helper ?? null),
        status: row.status,
        assignment,
        last_message_at: row.last_message_at,
        unread_count: unread,
        created_at: row.created_at,
    };
}

/** GET /conversations/:id */
export const getConversation = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID percakapan tidak valid.');

    const found = await loadConversationForUser(id, userId);
    if (found.error === 'not_found') return fail(res, 404, 'Percakapan tidak ditemukan.');
    if (found.error === 'forbidden') return fail(res, 403, 'Anda tidak memiliki akses ke percakapan ini.');

    return ok(res, 'Detail percakapan berhasil diambil', await conversationDetail(id, userId));
};

/**
 * GET /conversations/:id/messages?before= — cursor pagination, newest first.
 */
export const listMessages = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID percakapan tidak valid.');

    const found = await loadConversationForUser(id, userId);
    if (found.error === 'not_found') return fail(res, 404, 'Percakapan tidak ditemukan.');
    if (found.error === 'forbidden') return fail(res, 403, 'Anda tidak memiliki akses ke percakapan ini.');

    const limitRaw = Number(req.query.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 30;
    const beforeRaw = Number(req.query.before);
    const before = Number.isInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : null;

    const conditions = [eq(message_table.conversation_id, id)];
    if (before) conditions.push(lt(message_table.id, before));

    const rows = await db
        .select({
            id: message_table.id,
            body: message_table.body,
            created_at: message_table.created_at,
            sender_id: message_table.sender_id,
            sender_name: user_table.full_name,
            sender_avatar: user_table.avatar_file_key,
            file_key: file_table.key,
            file_mime: file_table.mime,
            file_name: file_table.original_name,
        })
        .from(message_table)
        .innerJoin(user_table, eq(message_table.sender_id, user_table.id))
        .leftJoin(file_table, eq(message_table.file_id, file_table.id))
        .where(and(...conditions))
        .orderBy(desc(message_table.id))
        .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextBefore = hasMore ? page[page.length - 1].id : null;

    return ok(res, 'Riwayat pesan berhasil diambil', {
        messages: page.map((row) => ({
            id: row.id,
            body: row.body,
            created_at: row.created_at,
            sender: {
                id: row.sender_id,
                full_name: row.sender_name,
                avatar_url: row.sender_avatar ? publicUrl(row.sender_avatar) : null,
            },
            file: row.file_key
                ? { file_key: row.file_key, mime: row.file_mime, name: row.file_name, url: publicUrl(row.file_key) }
                : null,
            is_mine: row.sender_id === userId,
        })),
        next_before: nextBefore,
    });
};

/** POST /conversations/:id/messages */
export const sendMessage = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID percakapan tidak valid.');

    const found = await loadConversationForUser(id, userId);
    if (found.error === 'not_found') return fail(res, 404, 'Percakapan tidak ditemukan.');
    if (found.error === 'forbidden') return fail(res, 403, 'Anda tidak memiliki akses ke percakapan ini.');
    const conversation = found.conversation!;

    if (conversation.status !== 'ACTIVE') {
        return fail(res, 409, 'Percakapan sudah tidak aktif.');
    }

    const counterpartId = conversation.requester_id === userId
        ? conversation.helper_id
        : conversation.requester_id;

    if (await isBlockedPair(userId, counterpartId)) {
        return fail(res, 403, 'Tidak dapat mengirim pesan karena pengguna ini diblokir.');
    }

    const body: string | undefined = req.body.body;
    const fileKey: string | undefined = req.body.file_key;

    let fileId: number | null = null;
    if (fileKey) {
        const [file] = await db.select()
            .from(file_table)
            .where(and(eq(file_table.key, fileKey), eq(file_table.owner_id, userId)))
            .limit(1);
        if (!file) return fail(res, 404, 'File tidak ditemukan.');
        if (file.status !== 'UPLOADED') return fail(res, 400, 'File belum diunggah.');
        if (file.purpose !== 'CHAT_ATTACHMENT') return fail(res, 400, 'File bukan untuk lampiran chat.');
        fileId = file.id;
    }

    const [message] = await db.transaction(async (tx) => {
        const [created] = await tx.insert(message_table).values({
            conversation_id: id,
            sender_id: userId,
            body: body ?? null,
            file_id: fileId,
        }).returning();

        const preview = body
            ? body.slice(0, 160)
            : (fileKey ? 'Mengirim lampiran' : '');

        await tx.update(conversation_table)
            .set({ last_message_at: created.created_at, last_message_preview: preview })
            .where(eq(conversation_table.id, id));

        await notify(tx, counterpartId, {
            type: 'chat.message',
            title: 'Pesan baru',
            body: preview || 'Anda menerima pesan baru',
            data: { conversation_id: id, message_id: created.id },
        });

        return [created];
    });

    return res.status(201).json({
        success: true,
        message: 'Pesan berhasil dikirim',
        data: {
            id: message.id,
            conversation_id: id,
            body: message.body,
            file_key: fileKey ?? null,
            created_at: message.created_at,
        },
    });
};

/** POST /conversations/:id/read */
export const markConversationRead = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID percakapan tidak valid.');

    const found = await loadConversationForUser(id, userId);
    if (found.error === 'not_found') return fail(res, 404, 'Percakapan tidak ditemukan.');
    if (found.error === 'forbidden') return fail(res, 403, 'Anda tidak memiliki akses ke percakapan ini.');

    let lastReadId: number | null = req.body?.last_read_message_id ?? null;
    if (!lastReadId) {
        const [latest] = await db
            .select({ id: message_table.id })
            .from(message_table)
            .where(eq(message_table.conversation_id, id))
            .orderBy(desc(message_table.id))
            .limit(1);
        lastReadId = latest?.id ?? null;
    }

    await db.insert(conversation_read_table)
        .values({
            conversation_id: id,
            user_id: userId,
            last_read_message_id: lastReadId,
            last_read_at: new Date(),
        })
        .onConflictDoUpdate({
            target: [conversation_read_table.conversation_id, conversation_read_table.user_id],
            set: { last_read_message_id: lastReadId, last_read_at: new Date() },
        });

    return ok(res, 'Percakapan ditandai sudah dibaca', { last_read_message_id: lastReadId });
};

/** POST /conversations/:id/decline — requester declines this helper. */
export const declineConversation = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID percakapan tidak valid.');

    const found = await loadConversationForUser(id, userId);
    if (found.error === 'not_found') return fail(res, 404, 'Percakapan tidak ditemukan.');
    if (found.error === 'forbidden') return fail(res, 403, 'Anda tidak memiliki akses ke percakapan ini.');
    const conversation = found.conversation!;

    if (conversation.requester_id !== userId) {
        return fail(res, 403, 'Hanya pembuat request yang dapat menolak helper.');
    }
    if (conversation.status === 'DECLINED') {
        return fail(res, 409, 'Helper ini sudah ditolak sebelumnya.');
    }

    await db.transaction(async (tx) => {
        await tx.update(conversation_table)
            .set({ status: 'DECLINED' })
            .where(eq(conversation_table.id, id));

        // Withdraw a still-unfunded agreement with this helper.
        const [assignment] = await tx
            .select({ id: assignment_table.id, status: assignment_table.status })
            .from(assignment_table)
            .where(and(
                eq(assignment_table.request_id, conversation.request_id),
                eq(assignment_table.helper_id, conversation.helper_id),
                eq(assignment_table.status, 'PENDING_AGREEMENT'),
            ))
            .limit(1);

        if (assignment) {
            const now = new Date();
            await tx.update(assignment_table)
                .set({ status: 'CANCELLED', cancelled_at: now, updated_at: now })
                .where(eq(assignment_table.id, assignment.id));
            await tx.update(request_table)
                .set({ status: 'OPEN', updated_at: now })
                .where(eq(request_table.id, conversation.request_id));

            await notify(tx, conversation.helper_id, {
                type: 'assignment.cancelled',
                title: 'Assignment dibatalkan',
                body: 'Requester menolak bantuan Anda sebelum agreement disetujui.',
                data: { assignment_id: assignment.id },
            });
        }

        await notify(tx, conversation.helper_id, {
            type: 'chat.declined',
            title: 'Bantuan ditolak',
            body: 'Requester menolak bantuan Anda pada request ini.',
            data: { conversation_id: id },
        });
        await recordAudit(tx, {
            actorId: userId,
            action: 'conversation.decline',
            entityType: 'conversation',
            entityId: id,
            metadata: { helper_id: conversation.helper_id },
        });
    });

    return ok(res, 'Helper berhasil ditolak', { conversation_id: id, status: 'DECLINED' });
};

export async function unreadMessageCount(userId: number): Promise<number> {
    const rows = await db
        .select({ conversation_id: conversation_table.id })
        .from(conversation_table)
        .where(and(
            or(
                eq(conversation_table.requester_id, userId),
                eq(conversation_table.helper_id, userId),
            )!,
            eq(conversation_table.status, 'ACTIVE'),
        ));

    let total = 0;
    for (const row of rows) {
        total += await unreadCount(row.conversation_id, userId);
    }
    return total;
}
