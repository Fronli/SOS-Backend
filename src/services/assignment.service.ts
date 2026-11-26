import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/db';
import {
    assignment_request_table, assignment_table, conversation_table,
    dispute_table, request_table, review_table, user_table,
} from '../db/schema';
import { notify } from './notification.service';
import { recordAudit } from './audit.service';
import { hold, platformFee, refund, release } from './wallet.service';
import { publicUrl } from './storage.service';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AssignmentStatus =
    | 'PENDING_AGREEMENT' | 'ON_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';

export const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = [
    'PENDING_AGREEMENT', 'ON_PROGRESS', 'DISPUTED',
];

/** Serialises an assignment row for API responses. */
export function shapeAssignment(row: {
    id: number;
    request_id: number;
    requester_id: number;
    helper_id: number;
    status: AssignmentStatus;
    amount: number;
    deadline_at: Date;
    terms: string;
    requester_approved_at: Date | null;
    helper_approved_at: Date | null;
    funded_at: Date | null;
    started_at: Date | null;
    completed_at: Date | null;
    cancelled_at: Date | null;
    created_at: Date;
    updated_at: Date;
}, extras: Record<string, unknown> = {}) {
    return {
        id: row.id,
        request_id: row.request_id,
        requester_id: row.requester_id,
        helper_id: row.helper_id,
        status: row.status,
        amount: row.amount,
        deadline_at: row.deadline_at,
        terms: row.terms,
        requester_approved_at: row.requester_approved_at,
        helper_approved_at: row.helper_approved_at,
        funded_at: row.funded_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
        cancelled_at: row.cancelled_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        ...extras,
    };
}

export async function getAssignmentForParticipant(assignmentId: number, userId: number) {
    const [row] = await db.select().from(assignment_table)
        .where(eq(assignment_table.id, assignmentId)).limit(1);
    if (!row) return { error: 'not_found' as const, assignment: null };
    if (row.requester_id !== userId && row.helper_id !== userId) {
        return { error: 'forbidden' as const, assignment: null };
    }
    return { error: null, assignment: row };
}

export async function getAssignmentDetail(assignmentId: number) {
    const [row] = await db.select().from(assignment_table)
        .where(eq(assignment_table.id, assignmentId)).limit(1);
    if (!row) return null;

    const [request, requester, helper, review, dispute, pending] = await Promise.all([
        db.select({ id: request_table.id, title: request_table.title, status: request_table.status, description: request_table.description })
            .from(request_table).where(eq(request_table.id, row.request_id)).limit(1),
        db.select({ id: user_table.id, full_name: user_table.full_name, avatar_file_key: user_table.avatar_file_key, university: user_table.university, major: user_table.major, student_verified_at: user_table.student_verified_at })
            .from(user_table).where(eq(user_table.id, row.requester_id)).limit(1),
        db.select({ id: user_table.id, full_name: user_table.full_name, avatar_file_key: user_table.avatar_file_key, university: user_table.university, major: user_table.major, student_verified_at: user_table.student_verified_at })
            .from(user_table).where(eq(user_table.id, row.helper_id)).limit(1),
        db.select().from(review_table).where(eq(review_table.assignment_id, assignmentId)).limit(1),
        db.select().from(dispute_table).where(eq(dispute_table.assignment_id, assignmentId))
            .orderBy(desc(dispute_table.created_at)).limit(1),
        db.select().from(assignment_request_table)
            .where(and(
                eq(assignment_request_table.assignment_id, assignmentId),
                eq(assignment_request_table.status, 'PENDING'),
            ))
            .orderBy(desc(assignment_request_table.created_at)),
    ]);

    const person = (user: typeof requester[number] | undefined) => user ? {
        id: user.id,
        full_name: user.full_name,
        university: user.university,
        major: user.major,
        avatar_url: user.avatar_file_key ? publicUrl(user.avatar_file_key) : null,
        is_student_verified: Boolean(user.student_verified_at),
    } : null;

    return shapeAssignment(row, {
        request: request[0] ?? null,
        requester: person(requester[0]),
        helper: person(helper[0]),
        review: review[0] ?? null,
        dispute: dispute[0] ?? null,
        pending_requests: pending,
        can_fund: row.status === 'PENDING_AGREEMENT'
            && Boolean(row.requester_approved_at)
            && Boolean(row.helper_approved_at),
    });
}

/**
 * Creates an assignment snapshot for an accepted helper.
 * Locks the request so two accepts cannot race.
 */
export async function createAssignmentForRequest(options: {
    tx: Tx;
    request: {
        id: number;
        requester_id: number;
        title: string;
        budget_amount: number;
        deadline_at: Date;
        description: string;
    };
    helperId: number;
    amount?: number;
    terms?: string;
    deadlineAt?: Date;
    actorId: number;
}) {
    const { tx, request, helperId, actorId } = options;

    if (request.requester_id === helperId) {
        return { error: true as const, status: 400, message: 'Anda tidak dapat menugaskan diri sendiri.' };
    }

    const [helper] = await tx.select({ id: user_table.id, status: user_table.status, full_name: user_table.full_name })
        .from(user_table).where(eq(user_table.id, helperId)).limit(1);
    if (!helper || helper.status !== 'ACTIVE') {
        return { error: true as const, status: 404, message: 'Helper tidak ditemukan atau tidak aktif.' };
    }

    const [active] = await tx.select({ id: assignment_table.id })
        .from(assignment_table)
        .where(and(
            eq(assignment_table.request_id, request.id),
            inArray(assignment_table.status, ACTIVE_ASSIGNMENT_STATUSES),
        ))
        .limit(1);
    if (active) {
        return { error: true as const, status: 409, message: 'Request sudah memiliki assignment aktif.' };
    }

    const amount = options.amount ?? request.budget_amount;
    const deadline = options.deadlineAt ?? request.deadline_at;
    const terms = options.terms
        ?? `Bantuan untuk "${request.title}" sesuai deskripsi request. Dana dilepas setelah requester mengonfirmasi penyelesaian.`;

    const [assignment] = await tx.insert(assignment_table).values({
        request_id: request.id,
        requester_id: request.requester_id,
        helper_id: helperId,
        status: 'PENDING_AGREEMENT',
        amount,
        deadline_at: deadline,
        terms,
    }).returning();

    // Ensure the pair has a conversation to negotiate in.
    await tx.insert(conversation_table).values({
        request_id: request.id,
        requester_id: request.requester_id,
        helper_id: helperId,
        status: 'ACTIVE',
    }).onConflictDoNothing({ target: [conversation_table.request_id, conversation_table.helper_id] });

    await notify(tx, helperId, {
        type: 'assignment.created',
        title: 'Bantuan Anda diterima',
        body: `Requester menerima bantuan Anda untuk "${request.title}". Silakan tinjau agreement.`,
        data: { assignment_id: assignment.id, request_id: request.id },
    });
    await recordAudit(tx, {
        actorId,
        action: 'assignment.create',
        entityType: 'assignment',
        entityId: assignment.id,
        metadata: { request_id: request.id, helper_id: helperId, amount },
    });

    return { error: false as const, assignment, helper };
}

/** Requester and helper must both approve before funding. */
export async function approveAgreement(tx: Tx, assignment: typeof assignment_table.$inferSelect, userId: number) {
    if (assignment.status !== 'PENDING_AGREEMENT') {
        return { error: true as const, status: 409, message: 'Agreement tidak dalam status menunggu persetujuan.' };
    }

    const now = new Date();
    const isRequester = assignment.requester_id === userId;
    const isHelper = assignment.helper_id === userId;

    if (!isRequester && !isHelper) {
        return { error: true as const, status: 403, message: 'Anda bukan pihak dalam assignment ini.' };
    }

    if (isRequester && assignment.requester_approved_at) {
        return { error: true as const, status: 409, message: 'Anda sudah menyetujui agreement ini.' };
    }
    if (isHelper && assignment.helper_approved_at) {
        return { error: true as const, status: 409, message: 'Anda sudah menyetujui agreement ini.' };
    }

    const [updated] = await tx.update(assignment_table)
        .set({
            requester_approved_at: isRequester ? now : assignment.requester_approved_at,
            helper_approved_at: isHelper ? now : assignment.helper_approved_at,
            updated_at: now,
        })
        .where(eq(assignment_table.id, assignment.id))
        .returning();

    const counterpartId = isRequester ? assignment.helper_id : assignment.requester_id;
    await notify(tx, counterpartId, {
        type: 'assignment.agreement_approved',
        title: 'Agreement disetujui',
        body: `${isRequester ? 'Requester' : 'Helper'} menyetujui agreement.`,
        data: { assignment_id: assignment.id },
    });
    await recordAudit(tx, {
        actorId: userId,
        action: 'assignment.agreement_approve',
        entityType: 'assignment',
        entityId: assignment.id,
        metadata: { side: isRequester ? 'requester' : 'helper' },
    });

    return { error: false as const, assignment: updated };
}

/**
 * Holds the requester's funds and moves the assignment to ON_PROGRESS.
 * Wallet service enforces balance and writes the ledger.
 */
export async function fundAssignment(tx: Tx, assignment: typeof assignment_table.$inferSelect) {
    if (assignment.status !== 'PENDING_AGREEMENT') {
        return { error: true as const, status: 409, message: 'Assignment tidak dalam status menunggu agreement.' };
    }
    if (!assignment.requester_approved_at || !assignment.helper_approved_at) {
        return { error: true as const, status: 409, message: 'Kedua pihak harus menyetujui agreement sebelum pendanaan.' };
    }

    // hold() throws WalletError(402) which the controller maps to a response.
    await hold(tx, assignment.requester_id, assignment.amount, {
        type: 'assignment',
        id: assignment.id,
    });

    const now = new Date();
    const [updated] = await tx.update(assignment_table)
        .set({ status: 'ON_PROGRESS', funded_at: now, started_at: now, updated_at: now })
        .where(eq(assignment_table.id, assignment.id))
        .returning();

    await tx.update(request_table)
        .set({ updated_at: now })
        .where(eq(request_table.id, assignment.request_id));

    await notify(tx, assignment.helper_id, {
        type: 'assignment.funded',
        title: 'Dana dikunci, pekerjaan dimulai',
        body: 'Requester telah mendanai assignment. Silakan mulai mengerjakan.',
        data: { assignment_id: assignment.id },
    });
    await recordAudit(tx, {
        actorId: assignment.requester_id,
        action: 'assignment.fund',
        entityType: 'assignment',
        entityId: assignment.id,
        metadata: { amount: assignment.amount },
    });

    return { error: false as const, assignment: updated };
}

/** Creates a pending completion/cancellation request from either party. */
export async function createAssignmentRequest(
    tx: Tx,
    options: {
        assignment: typeof assignment_table.$inferSelect;
        kind: 'COMPLETION' | 'CANCELLATION';
        requestedBy: number;
        reason?: string;
    },
) {
    const { assignment, kind, requestedBy, reason } = options;

    if (assignment.status !== 'ON_PROGRESS') {
        return { error: true as const, status: 409, message: 'Aksi ini hanya tersedia saat assignment berjalan.' };
    }

    const [pending] = await tx.select({ id: assignment_request_table.id })
        .from(assignment_request_table)
        .where(and(
            eq(assignment_request_table.assignment_id, assignment.id),
            eq(assignment_request_table.kind, kind),
            eq(assignment_request_table.status, 'PENDING'),
        ))
        .limit(1);

    if (pending) {
        return { error: true as const, status: 409, message: 'Sudah ada permintaan yang menunggu konfirmasi pihak lain.' };
    }

    const [created] = await tx.insert(assignment_request_table).values({
        assignment_id: assignment.id,
        kind,
        requested_by: requestedBy,
        reason: reason ?? null,
    }).returning();

    const counterpartId = requestedBy === assignment.requester_id
        ? assignment.helper_id
        : assignment.requester_id;

    await notify(tx, counterpartId, {
        type: kind === 'COMPLETION' ? 'assignment.completion_requested' : 'assignment.cancellation_requested',
        title: kind === 'COMPLETION' ? 'Permintaan penyelesaian' : 'Permintaan pembatalan',
        body: kind === 'COMPLETION'
            ? 'Pihak lain mengajukan penyelesaian. Konfirmasi bila pekerjaan sudah selesai.'
            : `Pihak lain mengajukan pembatalan${reason ? `: ${reason}` : '.'}`,
        data: { assignment_id: assignment.id, request_id: created.id },
    });
    await recordAudit(tx, {
        actorId: requestedBy,
        action: kind === 'COMPLETION' ? 'assignment.completion_request' : 'assignment.cancellation_request',
        entityType: 'assignment',
        entityId: assignment.id,
        metadata: { reason: reason ?? null },
    });

    return { error: false as const, request: created };
}

/** Confirms completion: releases held funds (minus fee) to the helper. */
export async function confirmCompletion(
    tx: Tx,
    assignment: typeof assignment_table.$inferSelect,
    actorId: number,
) {
    const pending = await getPendingRequest(tx, assignment.id, 'COMPLETION');
    if (!pending) return { error: true as const, status: 409, message: 'Tidak ada permintaan penyelesaian.' };
    if (pending.requested_by === actorId) {
        return { error: true as const, status: 403, message: 'Konfirmasi harus dilakukan oleh pihak lain.' };
    }

    const fee = platformFee(assignment.amount);
    await release(tx, assignment.requester_id, assignment.helper_id, assignment.amount, {
        type: 'assignment',
        id: assignment.id,
    }, fee);

    const now = new Date();
    const [updated] = await tx.update(assignment_table)
        .set({ status: 'COMPLETED', completed_at: now, updated_at: now })
        .where(eq(assignment_table.id, assignment.id))
        .returning();

    await tx.update(assignment_request_table)
        .set({ status: 'CONFIRMED', resolved_at: now, resolved_by: actorId })
        .where(eq(assignment_request_table.id, pending.id));

    // Other pending requests for this assignment are moot.
    await tx.update(assignment_request_table)
        .set({ status: 'REJECTED', resolved_at: now, resolved_by: actorId })
        .where(and(
            eq(assignment_request_table.assignment_id, assignment.id),
            eq(assignment_request_table.status, 'PENDING'),
        ));

    await tx.update(request_table)
        .set({ status: 'COMPLETED', completed_at: now, updated_at: now })
        .where(eq(request_table.id, assignment.request_id));

    await tx.update(conversation_table)
        .set({ status: 'CLOSED' })
        .where(and(
            eq(conversation_table.request_id, assignment.request_id),
            eq(conversation_table.helper_id, assignment.helper_id),
        ));

    await notify(tx, assignment.helper_id, {
        type: 'assignment.completed',
        title: 'Pekerjaan selesai',
        body: `Dana sebesar Rp${assignment.amount - fee} telah dilepas ke saldo Anda.`,
        data: { assignment_id: assignment.id, amount: assignment.amount - fee },
    });
    await notify(tx, assignment.requester_id, {
        type: 'assignment.completed',
        title: 'Assignment selesai',
        body: 'Terima kasih! Jangan lupa beri rating untuk helper.',
        data: { assignment_id: assignment.id },
    });
    await recordAudit(tx, {
        actorId,
        action: 'assignment.complete',
        entityType: 'assignment',
        entityId: assignment.id,
        metadata: { amount: assignment.amount, fee },
    });

    return { error: false as const, assignment: updated, fee };
}

export async function rejectCompletion(
    tx: Tx,
    assignment: typeof assignment_table.$inferSelect,
    actorId: number,
    reason?: string,
) {
    const pending = await getPendingRequest(tx, assignment.id, 'COMPLETION');
    if (!pending) return { error: true as const, status: 409, message: 'Tidak ada permintaan penyelesaian.' };
    if (pending.requested_by === actorId) {
        return { error: true as const, status: 403, message: 'Penolakan harus dilakukan oleh pihak lain.' };
    }

    const now = new Date();
    await tx.update(assignment_request_table)
        .set({ status: 'REJECTED', resolved_at: now, resolved_by: actorId, reason: reason ?? pending.reason })
        .where(eq(assignment_request_table.id, pending.id));

    await notify(tx, assignment.requester_id === actorId ? assignment.helper_id : assignment.requester_id, {
        type: 'assignment.completion_rejected',
        title: 'Penyelesaian ditolak',
        body: reason ? `Penyelesaian ditolak: ${reason}` : 'Penyelesaian ditolak. Assignment kembali berjalan.',
        data: { assignment_id: assignment.id },
    });
    await recordAudit(tx, {
        actorId,
        action: 'assignment.completion_reject',
        entityType: 'assignment',
        entityId: assignment.id,
        metadata: { reason: reason ?? null },
    });

    return { error: false as const };
}

/** Confirms cancellation: refunds held funds and reopens the request. */
export async function confirmCancellation(
    tx: Tx,
    assignment: typeof assignment_table.$inferSelect,
    actorId: number,
) {
    const pending = await getPendingRequest(tx, assignment.id, 'CANCELLATION');
    if (!pending) return { error: true as const, status: 409, message: 'Tidak ada permintaan pembatalan.' };
    if (pending.requested_by === actorId) {
        return { error: true as const, status: 403, message: 'Konfirmasi harus dilakukan oleh pihak lain.' };
    }

    if (assignment.funded_at) {
        await refund(tx, assignment.requester_id, assignment.amount, {
            type: 'assignment',
            id: assignment.id,
        }, 'Refund pembatalan assignment');
    }

    const now = new Date();
    const [updated] = await tx.update(assignment_table)
        .set({ status: 'CANCELLED', cancelled_at: now, updated_at: now })
        .where(eq(assignment_table.id, assignment.id))
        .returning();

    await tx.update(assignment_request_table)
        .set({ status: 'CONFIRMED', resolved_at: now, resolved_by: actorId })
        .where(eq(assignment_request_table.id, pending.id));

    await tx.update(assignment_request_table)
        .set({ status: 'REJECTED', resolved_at: now, resolved_by: actorId })
        .where(and(
            eq(assignment_request_table.assignment_id, assignment.id),
            eq(assignment_request_table.status, 'PENDING'),
        ));

    await tx.update(request_table)
        .set({ status: 'OPEN', updated_at: now })
        .where(eq(request_table.id, assignment.request_id));

    await tx.update(conversation_table)
        .set({ status: 'CLOSED' })
        .where(and(
            eq(conversation_table.request_id, assignment.request_id),
            eq(conversation_table.helper_id, assignment.helper_id),
        ));

    await notify(tx, assignment.helper_id, {
        type: 'assignment.cancelled',
        title: 'Assignment dibatalkan',
        body: 'Assignment dibatalkan. Dana dikembalikan ke requester.',
        data: { assignment_id: assignment.id },
    });
    await notify(tx, assignment.requester_id, {
        type: 'assignment.cancelled',
        title: 'Pembatalan dikonfirmasi',
        body: 'Assignment dibatalkan dan dana Anda dikembalikan ke saldo.',
        data: { assignment_id: assignment.id },
    });
    await recordAudit(tx, {
        actorId,
        action: 'assignment.cancel_confirm',
        entityType: 'assignment',
        entityId: assignment.id,
        metadata: { refunded: Boolean(assignment.funded_at), amount: assignment.amount },
    });

    return { error: false as const, assignment: updated };
}

export async function rejectCancellation(
    tx: Tx,
    assignment: typeof assignment_table.$inferSelect,
    actorId: number,
) {
    const pending = await getPendingRequest(tx, assignment.id, 'CANCELLATION');
    if (!pending) return { error: true as const, status: 409, message: 'Tidak ada permintaan pembatalan.' };
    if (pending.requested_by === actorId) {
        return { error: true as const, status: 403, message: 'Penolakan harus dilakukan oleh pihak lain.' };
    }

    await tx.update(assignment_request_table)
        .set({ status: 'REJECTED', resolved_at: new Date(), resolved_by: actorId })
        .where(eq(assignment_request_table.id, pending.id));

    await notify(tx, assignment.requester_id === actorId ? assignment.helper_id : assignment.requester_id, {
        type: 'assignment.cancellation_rejected',
        title: 'Pembatalan ditolak',
        body: 'Permintaan pembatalan ditolak. Assignment tetap berjalan.',
        data: { assignment_id: assignment.id },
    });
    await recordAudit(tx, {
        actorId,
        action: 'assignment.cancel_reject',
        entityType: 'assignment',
        entityId: assignment.id,
    });

    return { error: false as const };
}

async function getPendingRequest(tx: Tx, assignmentId: number, kind: 'COMPLETION' | 'CANCELLATION') {
    const [row] = await tx.select().from(assignment_request_table)
        .where(and(
            eq(assignment_request_table.assignment_id, assignmentId),
            eq(assignment_request_table.kind, kind),
            eq(assignment_request_table.status, 'PENDING'),
        ))
        .orderBy(desc(assignment_request_table.created_at))
        .limit(1);
    return row ?? null;
}

/**
 * Admin dispute resolution. Reverses or releases funds inside the caller's
 * transaction so wallet, assignment, audit and notification commit together.
 */
export async function resolveDisputeFunds(
    tx: Tx,
    options: {
        assignment: typeof assignment_table.$inferSelect;
        decision: 'FULL_REFUND' | 'PARTIAL_REFUND' | 'RELEASE';
        refundAmount?: number;
        adminId: number;
        disputeId: number;
    },
) {
    const { assignment, decision, adminId, disputeId } = options;
    const heldAmount = assignment.amount;
    let refunded = 0;
    let released = 0;

    if (decision === 'FULL_REFUND') {
        refunded = heldAmount;
    } else if (decision === 'PARTIAL_REFUND') {
        refunded = options.refundAmount ?? 0;
        if (refunded <= 0 || refunded >= heldAmount) {
            return { error: true as const, status: 400, message: 'refund_amount harus lebih dari 0 dan kurang dari nominal assignment.' };
        }
    }

    if (refunded > 0 && assignment.funded_at) {
        await refund(tx, assignment.requester_id, refunded, { type: 'dispute', id: disputeId }, 'Refund hasil dispute');
    }

    released = heldAmount - refunded;
    if (released > 0 && assignment.funded_at) {
        const fee = platformFee(released);
        await release(tx, assignment.requester_id, assignment.helper_id, released, {
            type: 'dispute',
            id: disputeId,
        }, fee);
    }

    const now = new Date();
    const finalStatus = decision === 'FULL_REFUND' ? 'CANCELLED' : 'COMPLETED';
    const [updated] = await tx.update(assignment_table)
        .set({
            status: finalStatus,
            completed_at: finalStatus === 'COMPLETED' ? now : assignment.completed_at,
            cancelled_at: finalStatus === 'CANCELLED' ? now : assignment.cancelled_at,
            updated_at: now,
        })
        .where(eq(assignment_table.id, assignment.id))
        .returning();

    await tx.update(request_table)
        .set(finalStatus === 'COMPLETED'
            ? { status: 'COMPLETED', completed_at: now, updated_at: now }
            : { status: 'OPEN', updated_at: now })
        .where(eq(request_table.id, assignment.request_id));

    await recordAudit(tx, {
        actorId: adminId,
        action: 'dispute.resolve',
        entityType: 'dispute',
        entityId: disputeId,
        metadata: { decision, refunded, released },
    });
    await notify(tx, assignment.requester_id, {
        type: 'dispute.resolved',
        title: 'Dispute diputuskan',
        body: `Keputusan: ${decision}. Dana dikembalikan Rp${refunded}.`,
        data: { dispute_id: disputeId, assignment_id: assignment.id, decision },
    });
    await notify(tx, assignment.helper_id, {
        type: 'dispute.resolved',
        title: 'Dispute diputuskan',
        body: `Keputusan: ${decision}. Dana dilepas Rp${released}.`,
        data: { dispute_id: disputeId, assignment_id: assignment.id, decision },
    });

    return { error: false as const, assignment: updated, refunded, released };
}

export async function findActiveAssignmentForRequest(tx: Tx, requestId: number) {
    const [row] = await tx.select().from(assignment_table)
        .where(and(
            eq(assignment_table.request_id, requestId),
            inArray(assignment_table.status, ACTIVE_ASSIGNMENT_STATUSES),
        ))
        .limit(1);
    return row ?? null;
}

export async function lockRequest(tx: Tx, requestId: number) {
    const [row] = await tx.select().from(request_table)
        .where(and(eq(request_table.id, requestId), isNull(request_table.deleted_at)))
        .for('update');
    return row ?? null;
}

export const assignmentSql = sql;
