import { Request, Response } from 'express';
import { and, count, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db/db';
import {
    assignment_table, dispute_evidence_table, dispute_table, file_table,
    request_table, review_table,
} from '../db/schema';
import { recordAudit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import {
    approveAgreement, confirmCancellation, confirmCompletion,
    createAssignmentForRequest, createAssignmentRequest,
    fundAssignment, getAssignmentDetail, getAssignmentForParticipant,
    lockRequest, rejectCancellation, rejectCompletion, shapeAssignment,
} from '../services/assignment.service';
import { WalletError } from '../services/wallet.service';
import { fail, ok, paginated } from '../utils/response.util';
import { parseId } from '../utils/id.util';
import { parsePagination } from '../utils/pagination.util';
import { enumValue } from '../utils/enum.util';

function mapError(res: Response, result: { status: number; message: string }) {
    return fail(res, result.status, result.message);
}

/**
 * POST /requests/:id/assignments — accept a helper, creating the draft agreement.
 */
export const createAssignment = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const requestId = parseId(req.params.id);
    if (!requestId) return fail(res, 400, 'ID request tidak valid.');

    const { helper_id: helperId, amount, terms, deadline_at: deadlineAt } = req.body as {
        helper_id: number; amount?: number; terms?: string; deadline_at?: string;
    };

    let parsedDeadline: Date | undefined;
    if (deadlineAt) {
        const date = new Date(deadlineAt);
        if (Number.isNaN(date.getTime())) return fail(res, 400, 'deadline_at tidak valid.');
        parsedDeadline = date;
    }

    try {
        const result = await db.transaction(async (tx) => {
            const request = await lockRequest(tx, requestId);
            if (!request) {
                return { error: true as const, status: 404, message: 'Request tidak ditemukan.' };
            }
            if (request.requester_id !== userId) {
                return { error: true as const, status: 403, message: 'Hanya pembuat request yang dapat menerima helper.' };
            }
            if (request.status !== 'OPEN') {
                return { error: true as const, status: 409, message: 'Request ini tidak lagi menerima helper.' };
            }

            return createAssignmentForRequest({
                tx,
                request: {
                    id: request.id,
                    requester_id: request.requester_id,
                    title: request.title,
                    budget_amount: request.budget_amount,
                    deadline_at: request.deadline_at,
                    description: request.description,
                },
                helperId,
                amount,
                terms,
                deadlineAt: parsedDeadline,
                actorId: userId,
            });
        });

        if (result.error) return mapError(res, result);

        const detail = await getAssignmentDetail(result.assignment.id);
        return res.status(201).json({
            success: true,
            message: 'Helper diterima. Agreement menunggu persetujuan kedua pihak.',
            data: detail,
        });
    } catch (error) {
        if (error instanceof WalletError) return fail(res, error.status, error.message);
        throw error;
    }
};

/** GET /assignments/:id */
export const getAssignment = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const isAdmin = req.currentUser?.role === 'ADMIN';
    if (!isAdmin) {
        const found = await getAssignmentForParticipant(id, userId);
        if (found.error === 'not_found') return fail(res, 404, 'Assignment tidak ditemukan.');
        if (found.error === 'forbidden') return fail(res, 403, 'Anda tidak memiliki akses ke assignment ini.');
    }

    const detail = await getAssignmentDetail(id);
    if (!detail) return fail(res, 404, 'Assignment tidak ditemukan.');
    return ok(res, 'Detail assignment berhasil diambil', detail);
};

/** GET /assignments/:id/agreement */
export const getAgreement = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const found = await getAssignmentForParticipant(id, userId);
    if (found.error === 'not_found') return fail(res, 404, 'Assignment tidak ditemukan.');
    if (found.error === 'forbidden') return fail(res, 403, 'Anda tidak memiliki akses ke assignment ini.');
    const assignment = found.assignment!;

    const [request] = await db.select({ id: request_table.id, title: request_table.title, description: request_table.description })
        .from(request_table).where(eq(request_table.id, assignment.request_id)).limit(1);

    return ok(res, 'Isi agreement berhasil diambil', {
        assignment_id: assignment.id,
        request,
        amount: assignment.amount,
        deadline_at: assignment.deadline_at,
        terms: assignment.terms,
        status: assignment.status,
        requester_approved_at: assignment.requester_approved_at,
        helper_approved_at: assignment.helper_approved_at,
        requester_approved: Boolean(assignment.requester_approved_at),
        helper_approved: Boolean(assignment.helper_approved_at),
    });
};

/** POST /assignments/:id/agreement/approve */
export const approveAgreementHandler = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [assignment] = await tx.select().from(assignment_table)
            .where(eq(assignment_table.id, id)).for('update');
        if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };
        return approveAgreement(tx, assignment, userId);
    });

    if (result.error) return mapError(res, result);

    const detail = await getAssignmentDetail(id);
    return ok(res, 'Agreement berhasil disetujui', detail);
};

/** POST /assignments/:id/fund — holds the requester's balance and starts the work. */
export const fundAssignmentHandler = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    try {
        const result = await db.transaction(async (tx) => {
            const [assignment] = await tx.select().from(assignment_table)
                .where(eq(assignment_table.id, id)).for('update');
            if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };
            if (assignment.requester_id !== userId) {
                return { error: true as const, status: 403, message: 'Hanya requester yang dapat mendanai assignment.' };
            }
            return fundAssignment(tx, assignment);
        });

        if (result.error) return mapError(res, result);

        const detail = await getAssignmentDetail(id);
        return ok(res, 'Dana berhasil dikunci. Assignment berjalan.', detail);
    } catch (error) {
        if (error instanceof WalletError) return fail(res, error.status, error.message);
        throw error;
    }
};

/** POST /assignments/:id/completion */
export const requestCompletion = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [assignment] = await tx.select().from(assignment_table)
            .where(eq(assignment_table.id, id)).for('update');
        if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };
        if (assignment.requester_id !== userId && assignment.helper_id !== userId) {
            return { error: true as const, status: 403, message: 'Anda bukan pihak dalam assignment ini.' };
        }
        return createAssignmentRequest(tx, {
            assignment,
            kind: 'COMPLETION',
            requestedBy: userId,
            reason: req.body?.reason,
        });
    });

    if (result.error) return mapError(res, result);
    return res.status(201).json({
        success: true,
        message: 'Permintaan penyelesaian dikirim. Menunggu konfirmasi pihak lain.',
        data: result.request,
    });
};

/** POST /assignments/:id/completion/confirm */
export const confirmCompletionHandler = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    try {
        const result = await db.transaction(async (tx) => {
            const [assignment] = await tx.select().from(assignment_table)
                .where(eq(assignment_table.id, id)).for('update');
            if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };
            if (assignment.requester_id !== userId && assignment.helper_id !== userId) {
                return { error: true as const, status: 403, message: 'Anda bukan pihak dalam assignment ini.' };
            }
            return confirmCompletion(tx, assignment, userId);
        });

        if (result.error) return mapError(res, result);

        const detail = await getAssignmentDetail(id);
        return ok(res, 'Penyelesaian dikonfirmasi dan dana dilepas', detail);
    } catch (error) {
        if (error instanceof WalletError) return fail(res, error.status, error.message);
        throw error;
    }
};

/** POST /assignments/:id/completion/reject */
export const rejectCompletionHandler = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [assignment] = await tx.select().from(assignment_table)
            .where(eq(assignment_table.id, id)).for('update');
        if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };
        if (assignment.requester_id !== userId && assignment.helper_id !== userId) {
            return { error: true as const, status: 403, message: 'Anda bukan pihak dalam assignment ini.' };
        }
        return rejectCompletion(tx, assignment, userId, req.body?.reason);
    });

    if (result.error) return mapError(res, result);

    const detail = await getAssignmentDetail(id);
    return ok(res, 'Permintaan penyelesaian ditolak. Assignment kembali berjalan.', detail);
};

/** POST /assignments/:id/cancellation */
export const requestCancellation = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [assignment] = await tx.select().from(assignment_table)
            .where(eq(assignment_table.id, id)).for('update');
        if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };
        if (assignment.requester_id !== userId && assignment.helper_id !== userId) {
            return { error: true as const, status: 403, message: 'Anda bukan pihak dalam assignment ini.' };
        }

        // Unfunded agreements can be cancelled immediately.
        if (assignment.status === 'PENDING_AGREEMENT') {
            const now = new Date();
            const [updated] = await tx.update(assignment_table)
                .set({ status: 'CANCELLED', cancelled_at: now, updated_at: now })
                .where(eq(assignment_table.id, id)).returning();
            await tx.update(request_table)
                .set({ status: 'OPEN', updated_at: now })
                .where(eq(request_table.id, assignment.request_id));
            await notify(tx, assignment.requester_id === userId ? assignment.helper_id : assignment.requester_id, {
                type: 'assignment.cancelled',
                title: 'Agreement dibatalkan',
                body: 'Agreement sebelum pendanaan dibatalkan.',
                data: { assignment_id: assignment.id },
            });
            await recordAudit(tx, {
                actorId: userId,
                action: 'assignment.cancel_unfunded',
                entityType: 'assignment',
                entityId: assignment.id,
            });
            return { error: false as const, assignment: updated, immediate: true };
        }

        const created = await createAssignmentRequest(tx, {
            assignment,
            kind: 'CANCELLATION',
            requestedBy: userId,
            reason: req.body?.reason,
        });
        if (created.error) return created;
        return { error: false as const, assignment, immediate: false };
    });

    if (result.error) return mapError(res, result);

    const detail = await getAssignmentDetail(id);
    return ok(res, 'immediate' in result && result.immediate
        ? 'Assignment dibatalkan sebelum pendanaan.'
        : 'Permintaan pembatalan dikirim. Menunggu konfirmasi pihak lain.', detail);
};

/** POST /assignments/:id/cancellation/confirm */
export const confirmCancellationHandler = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    try {
        const result = await db.transaction(async (tx) => {
            const [assignment] = await tx.select().from(assignment_table)
                .where(eq(assignment_table.id, id)).for('update');
            if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };
            if (assignment.requester_id !== userId && assignment.helper_id !== userId) {
                return { error: true as const, status: 403, message: 'Anda bukan pihak dalam assignment ini.' };
            }
            return confirmCancellation(tx, assignment, userId);
        });

        if (result.error) return mapError(res, result);

        const detail = await getAssignmentDetail(id);
        return ok(res, 'Pembatalan dikonfirmasi dan dana dikembalikan', detail);
    } catch (error) {
        if (error instanceof WalletError) return fail(res, error.status, error.message);
        throw error;
    }
};

/** POST /assignments/:id/cancellation/reject */
export const rejectCancellationHandler = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [assignment] = await tx.select().from(assignment_table)
            .where(eq(assignment_table.id, id)).for('update');
        if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };
        if (assignment.requester_id !== userId && assignment.helper_id !== userId) {
            return { error: true as const, status: 403, message: 'Anda bukan pihak dalam assignment ini.' };
        }
        return rejectCancellation(tx, assignment, userId);
    });

    if (result.error) return mapError(res, result);

    const detail = await getAssignmentDetail(id);
    return ok(res, 'Permintaan pembatalan ditolak. Assignment tetap berjalan.', detail);
};

/** POST /assignments/:id/review — requester reviews the helper once, after completion. */
export const createReview = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const [assignment] = await db.select().from(assignment_table)
        .where(eq(assignment_table.id, id)).limit(1);
    if (!assignment) return fail(res, 404, 'Assignment tidak ditemukan.');
    if (assignment.requester_id !== userId) {
        return fail(res, 403, 'Hanya requester yang dapat memberi rating.');
    }
    if (assignment.status !== 'COMPLETED') {
        return fail(res, 409, 'Rating hanya dapat diberikan setelah assignment selesai.');
    }

    const [existing] = await db.select({ id: review_table.id })
        .from(review_table).where(eq(review_table.assignment_id, id)).limit(1);
    if (existing) return fail(res, 409, 'Anda sudah memberi rating untuk assignment ini.');

    const { rating, comment } = req.body as { rating: number; comment?: string };

    const review = await db.transaction(async (tx) => {
        const [created] = await tx.insert(review_table).values({
            assignment_id: id,
            requester_id: userId,
            helper_id: assignment.helper_id,
            rating,
            comment: comment ?? null,
        }).returning();

        await notify(tx, assignment.helper_id, {
            type: 'review.created',
            title: 'Review baru',
            body: `Anda menerima rating ${rating}/5 untuk pekerjaan terakhir.`,
            data: { assignment_id: id, rating },
        });
        await recordAudit(tx, {
            actorId: userId,
            action: 'review.create',
            entityType: 'assignment',
            entityId: id,
            metadata: { rating },
        });
        return created;
    });

    return res.status(201).json({
        success: true,
        message: 'Rating berhasil dikirim',
        data: review,
    });
};

/** POST /assignments/:id/disputes */
export const createDispute = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID assignment tidak valid.');

    const [assignment] = await db.select().from(assignment_table)
        .where(eq(assignment_table.id, id)).limit(1);
    if (!assignment) return fail(res, 404, 'Assignment tidak ditemukan.');
    if (assignment.requester_id !== userId && assignment.helper_id !== userId) {
        return fail(res, 403, 'Anda bukan pihak dalam assignment ini.');
    }
    if (!['ON_PROGRESS', 'COMPLETED', 'DISPUTED'].includes(assignment.status)) {
        return fail(res, 409, 'Dispute hanya dapat diajukan pada assignment yang sudah didanai.');
    }

    const { reason, evidence_keys: evidenceKeys = [] } = req.body as {
        reason: string; evidence_keys?: string[];
    };

    const files = evidenceKeys.length > 0
        ? await db.select({ id: file_table.id, key: file_table.key, owner_id: file_table.owner_id, purpose: file_table.purpose, status: file_table.status })
            .from(file_table)
            .where(inArray(file_table.key, [...new Set(evidenceKeys)]))
        : [];

    const invalid = evidenceKeys.filter((key) => !files.some((file) => file.key === key
        && file.owner_id === userId
        && file.status === 'UPLOADED'
        && file.purpose === 'DISPUTE_EVIDENCE'));
    if (invalid.length > 0) {
        return fail(res, 400, 'Sebagian bukti tidak valid.', { invalid_file_keys: invalid });
    }

    const dispute = await db.transaction(async (tx) => {
        const [created] = await tx.insert(dispute_table).values({
            assignment_id: id,
            raised_by: userId,
            reason,
            status: 'OPEN',
        }).returning();

        if (files.length > 0) {
            await tx.insert(dispute_evidence_table).values(
                files.map((file) => ({ dispute_id: created.id, file_id: file.id })),
            );
        }

        if (assignment.status !== 'DISPUTED') {
            await tx.update(assignment_table)
                .set({ status: 'DISPUTED', updated_at: new Date() })
                .where(eq(assignment_table.id, id));
        }

        await notify(tx, assignment.requester_id === userId ? assignment.helper_id : assignment.requester_id, {
            type: 'dispute.created',
            title: 'Dispute diajukan',
            body: 'Pihak lain mengajukan dispute. Admin akan meninjau kasus ini.',
            data: { dispute_id: created.id, assignment_id: id },
        });
        await recordAudit(tx, {
            actorId: userId,
            action: 'dispute.create',
            entityType: 'dispute',
            entityId: created.id,
            metadata: { assignment_id: id, evidence: files.length },
        });
        return created;
    });

    return res.status(201).json({
        success: true,
        message: 'Dispute berhasil diajukan. Admin akan meninjau.',
        data: { ...dispute, evidence_keys: files.map((file) => file.key) },
    });
};

/** GET /me/assignments */
export const listMyAssignments = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const role = enumValue(['requester', 'helper'] as const, req.query.role);
    const status = enumValue(
        ['PENDING_AGREEMENT', 'ON_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED'] as const,
        req.query.status,
    );

    const filters = [];
    if (role === 'helper') {
        filters.push(eq(assignment_table.helper_id, userId));
    } else if (role === 'requester') {
        filters.push(eq(assignment_table.requester_id, userId));
    } else {
        filters.push(or(
            eq(assignment_table.requester_id, userId),
            eq(assignment_table.helper_id, userId),
        )!);
    }
    if (status) filters.push(eq(assignment_table.status, status));

    const whereClause = and(...filters)!;

    const [countRow] = await db.select({ total: count() }).from(assignment_table).where(whereClause);
    const rows = await db.select().from(assignment_table)
        .where(whereClause)
        .orderBy(desc(assignment_table.created_at), desc(assignment_table.id))
        .limit(limit)
        .offset(offset);

    const data = await Promise.all(rows.map(async (row) => {
        const [request] = await db.select({ id: request_table.id, title: request_table.title })
            .from(request_table).where(eq(request_table.id, row.request_id)).limit(1);
        const [review] = await db.select({ id: review_table.id, rating: review_table.rating })
            .from(review_table).where(eq(review_table.assignment_id, row.id)).limit(1);

        return shapeAssignment(row, {
            request: request ?? null,
            role: row.requester_id === userId ? 'requester' : 'helper',
            review: review ?? null,
            can_review: row.requester_id === userId && row.status === 'COMPLETED' && !review,
        });
    }));

    return paginated(res, 'Daftar assignment berhasil diambil', data, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};
