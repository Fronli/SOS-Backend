import { Request, Response } from 'express';
import {
    eq, and, isNull, sql, ilike, desc, asc, inArray, SQL, or, count, notExists,
} from 'drizzle-orm';
import { db } from '../db/db';
import {
    request_table, request_tag_table, tag_table, user_table,
    request_helper_table, request_attachment_table, file_table,
    assignment_table,
} from '../db/schema';
import { recordAudit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { publicUrl } from '../services/storage.service';
import { fail, ok, paginated } from '../utils/response.util';
import { parseId } from '../utils/id.util';
import { parsePagination } from '../utils/pagination.util';
import type { Tx } from '../utils/result.util';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Short requester profile for request responses. */
const requesterBriefFields = {
    id: user_table.id,
    full_name: user_table.full_name,
    university: user_table.university,
    major: user_table.major,
    avatar_file_key: user_table.avatar_file_key,
    student_verified_at: user_table.student_verified_at,
};

/** Escape SQL LIKE wildcards. */
function escapeLike(s: string): string {
    return s.replace(/[%_\\]/g, '\\$&');
}

/** Assignment rows that are still binding for a request. */
const ACTIVE_ASSIGNMENT_STATUSES = ['PENDING_AGREEMENT', 'ON_PROGRESS', 'DISPUTED'] as const;

function activeAssignmentExists() {
    return db
        .select({ one: sql`1` })
        .from(assignment_table)
        .where(and(
            eq(assignment_table.request_id, request_table.id),
            inArray(assignment_table.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
        ));
}

async function getTagsForRequest(requestId: number) {
    return db
        .select({ id: tag_table.id, name: tag_table.name, slug: tag_table.slug })
        .from(request_tag_table)
        .innerJoin(tag_table, eq(request_tag_table.tag_id, tag_table.id))
        .where(eq(request_tag_table.request_id, requestId));
}

async function getAttachmentsForRequest(requestId: number) {
    const rows = await db
        .select({
            id: file_table.id,
            key: file_table.key,
            mime: file_table.mime,
            byte_size: file_table.byte_size,
            original_name: file_table.original_name,
        })
        .from(request_attachment_table)
        .innerJoin(file_table, eq(request_attachment_table.file_id, file_table.id))
        .where(eq(request_attachment_table.request_id, requestId));

    return rows.map(({ key, ...rest }) => ({ ...rest, file_key: key, url: publicUrl(key) }));
}

const requestSelection = {
    id: request_table.id,
    requester_id: request_table.requester_id,
    title: request_table.title,
    description: request_table.description,
    estimated_time: request_table.estimated_time,
    deadline_at: request_table.deadline_at,
    budget_amount: request_table.budget_amount,
    status: request_table.status,
    created_at: request_table.created_at,
    updated_at: request_table.updated_at,
    requester: requesterBriefFields,
};

type RequestSelectionRow = {
    id: number;
    requester_id: number;
    title: string;
    description: string;
    estimated_time: 'fast' | 'moderate' | 'extended';
    deadline_at: Date;
    budget_amount: number;
    status: 'OPEN' | 'CANCELLED' | 'COMPLETED' | 'HIDDEN' | 'REMOVED';
    created_at: Date;
    updated_at: Date;
    requester: {
        id: number;
        full_name: string;
        university: string;
        major: string;
        avatar_file_key: string | null;
        student_verified_at: Date | null;
    };
};

function shapeRequest(row: RequestSelectionRow, extras: {
    tags?: unknown[];
    attachments?: unknown[];
}) {
    const { requester_id, requester, ...rest } = row;
    return {
        ...rest,
        is_expired: row.deadline_at.getTime() < Date.now(),
        requester: {
            ...requester,
            avatar_url: requester.avatar_file_key ? publicUrl(requester.avatar_file_key) : null,
            is_student_verified: Boolean(requester.student_verified_at),
        },
        ...(extras.tags ? { tags: extras.tags } : {}),
        ...(extras.attachments ? { attachments: extras.attachments } : {}),
    };
}

/** Build full request response object with tags, attachments and requester. */
async function buildRequestDetail(requestId: number, includeAttachments = true) {
    const [row] = await db
        .select(requestSelection)
        .from(request_table)
        .innerJoin(user_table, eq(request_table.requester_id, user_table.id))
        .where(and(eq(request_table.id, requestId), isNull(request_table.deleted_at)))
        .limit(1);

    if (!row) return null;

    const [tags, attachments] = await Promise.all([
        getTagsForRequest(requestId),
        includeAttachments ? getAttachmentsForRequest(requestId) : Promise.resolve(undefined),
    ]);

    return shapeRequest(row, { tags, attachments });
}

async function validateAttachments(userId: number, keys: string[]) {
    if (keys.length === 0) return { rows: [] as { id: number }[], missing: [] as string[] };

    const unique = [...new Set(keys)];
    const rows = await db
        .select({ id: file_table.id, key: file_table.key, status: file_table.status, owner_id: file_table.owner_id, purpose: file_table.purpose })
        .from(file_table)
        .where(inArray(file_table.key, unique));

    const valid = rows.filter((row) => row.owner_id === userId
        && row.status === 'UPLOADED'
        && row.purpose === 'REQUEST_ATTACHMENT');
    const validKeys = new Set(valid.map((row) => row.key));
    return { rows: valid, missing: unique.filter((key) => !validKeys.has(key)) };
}

async function attachFiles(tx: Tx, requestId: number, fileIds: number[]) {
    if (fileIds.length === 0) return;
    await tx.insert(request_attachment_table)
        .values(fileIds.map((fileId) => ({ request_id: requestId, file_id: fileId })))
        .onConflictDoNothing();
}

// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /requests — create a job request.
 */
export const createRequest = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const body = req.body as {
        title: string; description: string; estimated_time: 'fast' | 'moderate' | 'extended';
        deadline_at: string; budget_amount: number; tag_ids: number[];
        attachment_file_keys?: string[];
    };

    const tagIds = [...new Set(body.tag_ids)];
    if (tagIds.length !== body.tag_ids.length) {
        return fail(res, 400, 'tag_ids tidak boleh mengandung duplikat.');
    }

    const attachments = await validateAttachments(userId, body.attachment_file_keys ?? []);
    if (attachments.missing.length > 0) {
        return fail(res, 400, 'Sebagian lampiran tidak valid atau bukan milik Anda.', {
            invalid_file_keys: attachments.missing,
        });
    }

    const result = await db.transaction(async (tx) => {
        const existingTags = await tx
            .select({ id: tag_table.id })
            .from(tag_table)
            .where(inArray(tag_table.id, tagIds));

        if (existingTags.length !== tagIds.length) {
            const existingIds = new Set(existingTags.map((t) => t.id));
            const missing = tagIds.filter((id) => !existingIds.has(id));
            return { error: true as const, status: 400, message: `Tag dengan ID ${missing.join(', ')} tidak ditemukan.` };
        }

        const [newRequest] = await tx
            .insert(request_table)
            .values({
                requester_id: userId,
                title: body.title,
                description: body.description,
                estimated_time: body.estimated_time,
                deadline_at: new Date(body.deadline_at),
                budget_amount: body.budget_amount,
                status: 'OPEN',
            })
            .returning();

        await tx.insert(request_tag_table).values(
            tagIds.map((tagId) => ({ request_id: newRequest.id, tag_id: tagId })),
        );
        await attachFiles(tx, newRequest.id, attachments.rows.map((file) => file.id));

        await recordAudit(tx, {
            actorId: userId,
            action: 'request.create',
            entityType: 'request',
            entityId: newRequest.id,
            metadata: { budget_amount: body.budget_amount, tag_ids: tagIds },
        });

        return { error: false as const, request: newRequest };
    });

    if (result.error) return fail(res, result.status, result.message);

    const detail = await buildRequestDetail(result.request.id);
    return res.status(201).json({
        success: true,
        message: 'Request pekerjaan berhasil dibuat',
        data: detail,
    });
};

/**
 * GET /requests — Explore feed: only OPEN requests without an active assignment.
 */
export const listRequests_ = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const subjectSlug = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
    const sort = req.query.sort === 'deadline' || req.query.sort === 'budget' ? req.query.sort : 'newest';

    let tagId: number | undefined;
    if (req.query.tag_id !== undefined) {
        const parsed = Number(req.query.tag_id);
        if (Number.isInteger(parsed) && parsed > 0) tagId = parsed;
    }

    const conditions: SQL[] = [
        isNull(request_table.deleted_at),
        eq(request_table.status, 'OPEN'),
        notExists(activeAssignmentExists()),
    ];

    if (q) {
        const escaped = escapeLike(q);
        conditions.push(or(
            ilike(request_table.title, `%${escaped}%`),
            ilike(request_table.description, `%${escaped}%`),
        )!);
    }

    if (typeof req.query.estimated_time === 'string'
        && ['fast', 'moderate', 'extended'].includes(req.query.estimated_time)) {
        conditions.push(eq(request_table.estimated_time, req.query.estimated_time as 'fast' | 'moderate' | 'extended'));
    }

    if (tagId) {
        const tagged = db.select({ request_id: request_tag_table.request_id })
            .from(request_tag_table)
            .where(eq(request_tag_table.tag_id, tagId));
        conditions.push(inArray(request_table.id, tagged));
    }

    if (subjectSlug) {
        const tagged = db.select({ request_id: request_tag_table.request_id })
            .from(request_tag_table)
            .innerJoin(tag_table, eq(request_tag_table.tag_id, tag_table.id))
            .where(eq(tag_table.slug, subjectSlug));
        conditions.push(inArray(request_table.id, tagged));
    }

    const whereClause = and(...conditions)!;

    const orderBy = sort === 'deadline'
        ? [asc(request_table.deadline_at), desc(request_table.id)]
        : sort === 'budget'
            ? [desc(request_table.budget_amount), desc(request_table.id)]
            : [desc(request_table.created_at), desc(request_table.id)];

    const [countRow] = await db
        .select({ total: count() })
        .from(request_table)
        .where(whereClause);

    const rows = await db
        .select(requestSelection)
        .from(request_table)
        .innerJoin(user_table, eq(request_table.requester_id, user_table.id))
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset);

    const data = await Promise.all(rows.map(async (row) => shapeRequest(row, {
        tags: await getTagsForRequest(row.id),
    })));

    return paginated(res, 'Daftar request berhasil diambil', data, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

/**
 * GET /requests/:id — detail, hidden from non-owner/non-admin when moderated.
 */
export const getRequest = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID request tidak valid.');

    const [row] = await db
        .select({ id: request_table.id, requester_id: request_table.requester_id, status: request_table.status, deleted_at: request_table.deleted_at })
        .from(request_table)
        .where(eq(request_table.id, id))
        .limit(1);

    if (!row || row.deleted_at) return fail(res, 404, 'Request tidak ditemukan.');

    const isOwner = row.requester_id === req.user!.id;
    const isAdmin = req.currentUser?.role === 'ADMIN';
    if (!isOwner && !isAdmin && (row.status === 'HIDDEN' || row.status === 'REMOVED')) {
        return fail(res, 404, 'Request tidak ditemukan.');
    }

    const detail = await buildRequestDetail(id);
    if (!detail) return fail(res, 404, 'Request tidak ditemukan.');

    return ok(res, 'Detail request berhasil diambil', detail);
};

/**
 * GET /me/requests — own requests grouped by assignment state.
 */
export const listMyRequests = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const conditions: SQL[] = [
        eq(request_table.requester_id, userId),
        isNull(request_table.deleted_at),
    ];

    if (q) {
        const escaped = escapeLike(q);
        conditions.push(or(
            ilike(request_table.title, `%${escaped}%`),
            ilike(request_table.description, `%${escaped}%`),
        )!);
    }

    const hasActiveAssignment = db
        .select({ one: sql`1` })
        .from(assignment_table)
        .where(and(
            eq(assignment_table.request_id, request_table.id),
            inArray(assignment_table.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
        ));

    if (statusFilter === 'floating') {
        conditions.push(eq(request_table.status, 'OPEN'));
        conditions.push(notExists(hasActiveAssignment));
    } else if (statusFilter === 'on_progress') {
        conditions.push(sql`EXISTS (
            SELECT 1 FROM assignment_table a
            WHERE a.request_id = ${request_table.id}
              AND a.status IN ('ON_PROGRESS','DISPUTED')
        )`);
    } else if (statusFilter === 'completed') {
        conditions.push(eq(request_table.status, 'COMPLETED'));
    } else if (statusFilter === 'cancelled') {
        conditions.push(eq(request_table.status, 'CANCELLED'));
    }

    const whereClause = and(...conditions)!;

    const [countRow] = await db.select({ total: count() }).from(request_table).where(whereClause);
    const rows = await db
        .select(requestSelection)
        .from(request_table)
        .innerJoin(user_table, eq(request_table.requester_id, user_table.id))
        .where(whereClause)
        .orderBy(desc(request_table.created_at), desc(request_table.id))
        .limit(limit)
        .offset(offset);

    const data = await Promise.all(rows.map(async (row) => {
        const [tags, assignment] = await Promise.all([
            getTagsForRequest(row.id),
            db.select({
                id: assignment_table.id,
                status: assignment_table.status,
                helper_id: assignment_table.helper_id,
            }).from(assignment_table)
                .where(eq(assignment_table.request_id, row.id))
                .orderBy(desc(assignment_table.created_at))
                .limit(1),
        ]);
        return {
            ...shapeRequest(row, { tags }),
            assignment: assignment[0] ?? null,
        };
    }));

    return paginated(res, 'Daftar request Anda berhasil diambil', data, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

/**
 * PATCH /requests/:id — update own request.
 * Budget locks once an agreement/assignment exists.
 */
export const updateRequest = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID request tidak valid.');

    const body = req.body as Record<string, unknown>;
    if (Object.keys(body).length === 0) {
        return fail(res, 400, 'Tidak ada field yang dikirim untuk diperbarui.');
    }

    const updates: Record<string, unknown> = {};
    if ('title' in body) updates.title = body.title;
    if ('description' in body) updates.description = body.description;
    if ('estimated_time' in body) updates.estimated_time = body.estimated_time;
    if ('deadline_at' in body) updates.deadline_at = new Date(body.deadline_at as string);
    if ('budget_amount' in body) updates.budget_amount = body.budget_amount;

    let newTagIds: number[] | undefined;
    if ('tag_ids' in body) {
        newTagIds = [...new Set(body.tag_ids as number[])];
        if (newTagIds.length !== (body.tag_ids as number[]).length) {
            return fail(res, 400, 'tag_ids tidak boleh mengandung duplikat.');
        }
    }

    let attachmentIds: number[] | undefined;
    if ('attachment_file_keys' in body) {
        const attachments = await validateAttachments(userId, body.attachment_file_keys as string[]);
        if (attachments.missing.length > 0) {
            return fail(res, 400, 'Sebagian lampiran tidak valid atau bukan milik Anda.', {
                invalid_file_keys: attachments.missing,
            });
        }
        attachmentIds = attachments.rows.map((file) => file.id);
    }

    const result = await db.transaction(async (tx) => {
        const [existing] = await tx
            .select({
                id: request_table.id,
                requester_id: request_table.requester_id,
                deleted_at: request_table.deleted_at,
                status: request_table.status,
            })
            .from(request_table)
            .where(eq(request_table.id, id))
            .for('update');

        if (!existing || existing.deleted_at) {
            return { error: true as const, status: 404, message: 'Request tidak ditemukan.' };
        }
        if (existing.requester_id !== userId) {
            return { error: true as const, status: 403, message: 'Anda tidak memiliki akses untuk mengubah request ini.' };
        }
        if (['CANCELLED', 'COMPLETED', 'REMOVED'].includes(existing.status)) {
            return { error: true as const, status: 409, message: 'Request dengan status ini tidak dapat diubah.' };
        }

        const [assignmentCount] = await tx
            .select({ total: count() })
            .from(assignment_table)
            .where(eq(assignment_table.request_id, id));

        if (Number(assignmentCount?.total ?? 0) > 0) {
            if ('budget_amount' in body) {
                return {
                    error: true as const,
                    status: 409,
                    message: 'Budget tidak dapat diubah karena agreement sudah dibuat.',
                };
            }
            if (newTagIds || 'deadline_at' in body) {
                return {
                    error: true as const,
                    status: 409,
                    message: 'Request tidak dapat diubah karena sudah memiliki assignment.',
                };
            }
        }

        if (newTagIds) {
            const existingTags = await tx
                .select({ id: tag_table.id })
                .from(tag_table)
                .where(inArray(tag_table.id, newTagIds));
            if (existingTags.length !== newTagIds.length) {
                const existingIds = new Set(existingTags.map((t) => t.id));
                const missing = newTagIds.filter((tid) => !existingIds.has(tid));
                return { error: true as const, status: 400, message: `Tag dengan ID ${missing.join(', ')} tidak ditemukan.` };
            }
            await tx.delete(request_tag_table).where(eq(request_tag_table.request_id, id));
            await tx.insert(request_tag_table).values(
                newTagIds.map((tagId) => ({ request_id: id, tag_id: tagId })),
            );
        }

        if (attachmentIds) {
            await tx.delete(request_attachment_table).where(eq(request_attachment_table.request_id, id));
            await attachFiles(tx, id, attachmentIds);
        }

        updates.updated_at = new Date();
        await tx.update(request_table).set(updates).where(eq(request_table.id, id));

        await recordAudit(tx, {
            actorId: userId,
            action: 'request.update',
            entityType: 'request',
            entityId: id,
            metadata: { fields: Object.keys(body) },
        });

        return { error: false as const };
    });

    if (result.error) return fail(res, result.status, result.message);

    const detail = await buildRequestDetail(id);
    return ok(res, 'Request berhasil diperbarui', detail);
};

/**
 * POST /requests/:id/cancel — cancel a request without an active assignment.
 */
export const cancelRequest = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID request tidak valid.');

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

    const result = await db.transaction(async (tx) => {
        const [existing] = await tx
            .select({
                id: request_table.id,
                requester_id: request_table.requester_id,
                status: request_table.status,
                deleted_at: request_table.deleted_at,
            })
            .from(request_table)
            .where(eq(request_table.id, id))
            .for('update');

        if (!existing || existing.deleted_at) {
            return { error: true as const, status: 404, message: 'Request tidak ditemukan.' };
        }
        if (existing.requester_id !== userId) {
            return { error: true as const, status: 403, message: 'Anda tidak memiliki akses untuk membatalkan request ini.' };
        }
        if (existing.status !== 'OPEN') {
            return { error: true as const, status: 409, message: 'Hanya request berstatus OPEN yang dapat dibatalkan.' };
        }

        const [active] = await tx
            .select({ id: assignment_table.id })
            .from(assignment_table)
            .where(and(
                eq(assignment_table.request_id, id),
                inArray(assignment_table.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
            ))
            .limit(1);

        if (active) {
            return {
                error: true as const,
                status: 409,
                message: 'Request memiliki assignment aktif. Gunakan alur pembatalan assignment.',
            };
        }

        const now = new Date();
        await tx.update(request_table)
            .set({ status: 'CANCELLED', cancelled_at: now, updated_at: now })
            .where(eq(request_table.id, id));

        await recordAudit(tx, {
            actorId: userId,
            action: 'request.cancel',
            entityType: 'request',
            entityId: id,
            metadata: { reason },
        });

        return { error: false as const };
    });

    if (result.error) return fail(res, result.status, result.message);

    const detail = await buildRequestDetail(id);
    return ok(res, 'Request berhasil dibatalkan', detail);
};

/**
 * DELETE /requests/:id — legacy soft delete kept for compatibility.
 */
export const deleteRequest = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID request tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [existing] = await tx
            .select({ id: request_table.id, requester_id: request_table.requester_id, deleted_at: request_table.deleted_at })
            .from(request_table)
            .where(eq(request_table.id, id))
            .for('update');

        if (!existing || existing.deleted_at) return { error: true as const, status: 404, message: 'Request tidak ditemukan.' };
        if (existing.requester_id !== userId) return { error: true as const, status: 403, message: 'Anda tidak memiliki akses untuk menghapus request ini.' };

        const [active] = await tx
            .select({ id: assignment_table.id })
            .from(assignment_table)
            .where(and(
                eq(assignment_table.request_id, id),
                inArray(assignment_table.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
            ))
            .limit(1);

        if (active) {
            return { error: true as const, status: 409, message: 'Request tidak dapat dihapus karena memiliki assignment aktif.' };
        }

        const now = new Date();
        await tx.update(request_table)
            .set({ deleted_at: now, updated_at: now })
            .where(eq(request_table.id, id));
        await recordAudit(tx, {
            actorId: userId,
            action: 'request.delete',
            entityType: 'request',
            entityId: id,
        });
        return { error: false as const };
    });

    if (result.error) return fail(res, result.status, result.message);
    return res.status(204).send();
};

/** Used by chat/direct-request to notify the requester about activity. */
export async function touchRequest(requestId: number) {
    await db.update(request_table)
        .set({ updated_at: new Date() })
        .where(eq(request_table.id, requestId));
}

export async function notifyRequesterOfReply(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    requestId: number,
    requesterId: number,
    helperName: string,
) {
    await notify(tx, requesterId, {
        type: 'request.reply',
        title: 'Reply baru pada request Anda',
        body: `${helperName} menawarkan bantuan pada request Anda.`,
        data: { request_id: requestId },
    });
}
