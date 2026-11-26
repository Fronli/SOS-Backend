import { Request, Response } from 'express';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db/db';
import {
    assignment_table, conversation_table, dispute_evidence_table, dispute_table,
    file_table, message_table, user_table,
} from '../../db/schema';
import { recordAudit } from '../../services/audit.service';
import { notify } from '../../services/notification.service';
import { resolveDisputeFunds } from '../../services/assignment.service';
import { WalletError } from '../../services/wallet.service';
import { signedUrl } from '../../services/storage.service';
import { fail, ok, paginated } from '../../utils/response.util';
import { parseId } from '../../utils/id.util';
import { parsePagination } from '../../utils/pagination.util';
import { sendCsv, toCsv } from '../../utils/csv.util';
import { enumValue } from '../../utils/enum.util';

export const listDisputes = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const status = enumValue(['OPEN', 'IN_REVIEW', 'RESOLVED'] as const, req.query.status);

    const whereClause = status ? eq(dispute_table.status, status) : undefined;

    const countBase = db.select({ total: count() }).from(dispute_table).$dynamic();
    const base = db
        .select({
            id: dispute_table.id,
            assignment_id: dispute_table.assignment_id,
            raised_by: dispute_table.raised_by,
            reason: dispute_table.reason,
            status: dispute_table.status,
            decision: dispute_table.decision,
            created_at: dispute_table.created_at,
            resolved_at: dispute_table.resolved_at,
            amount: assignment_table.amount,
        })
        .from(dispute_table)
        .innerJoin(assignment_table, eq(dispute_table.assignment_id, assignment_table.id))
        .$dynamic();

    const [countRow] = await (whereClause ? countBase.where(whereClause) : countBase);
    const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(dispute_table.created_at))
        .limit(limit)
        .offset(offset);

    return paginated(res, 'Daftar dispute berhasil diambil', rows, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

export const getDispute = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID dispute tidak valid.');

    const [row] = await db.select().from(dispute_table).where(eq(dispute_table.id, id)).limit(1);
    if (!row) return fail(res, 404, 'Dispute tidak ditemukan.');

    const [assignment] = await db.select().from(assignment_table)
        .where(eq(assignment_table.id, row.assignment_id)).limit(1);

    const evidence = await db
        .select({
            file_id: file_table.id,
            key: file_table.key,
            mime: file_table.mime,
            original_name: file_table.original_name,
        })
        .from(dispute_evidence_table)
        .innerJoin(file_table, eq(dispute_evidence_table.file_id, file_table.id))
        .where(eq(dispute_evidence_table.dispute_id, id));

    const [raisedBy] = await db.select({ id: user_table.id, full_name: user_table.full_name, email: user_table.email })
        .from(user_table).where(eq(user_table.id, row.raised_by)).limit(1);

    let chatExcerpt: unknown[] = [];
    if (assignment) {
        const rows = await db
            .select({
                id: message_table.id,
                body: message_table.body,
                created_at: message_table.created_at,
                sender_name: user_table.full_name,
            })
            .from(message_table)
            .innerJoin(conversation_table, eq(message_table.conversation_id, conversation_table.id))
            .innerJoin(user_table, eq(message_table.sender_id, user_table.id))
            .where(and(
                eq(conversation_table.request_id, assignment.request_id),
                eq(conversation_table.helper_id, assignment.helper_id),
            ))
            .orderBy(desc(message_table.id))
            .limit(30);
        chatExcerpt = rows.reverse();
    }

    return ok(res, 'Detail dispute berhasil diambil', {
        ...row,
        raised_by_user: raisedBy ?? null,
        assignment,
        evidence: evidence.map((item) => ({
            ...item,
            url: signedUrl(item.key),
        })),
        chat_excerpt: chatExcerpt,
    });
};

export const claimDispute = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID dispute tidak valid.');

    const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(dispute_table)
            .where(eq(dispute_table.id, id)).for('update');
        if (!row) return { error: true as const, status: 404, message: 'Dispute tidak ditemukan.' };
        if (row.status === 'RESOLVED') {
            return { error: true as const, status: 409, message: 'Dispute sudah diselesaikan.' };
        }

        const [updated] = await tx.update(dispute_table)
            .set({ status: 'IN_REVIEW', claimed_by: adminId, claimed_at: new Date() })
            .where(eq(dispute_table.id, id)).returning();

        await recordAudit(tx, {
            actorId: adminId,
            action: 'dispute.claim',
            entityType: 'dispute',
            entityId: id,
        });
        return { error: false as const, row: updated };
    });

    if (result.error) return fail(res, result.status, result.message);
    return ok(res, 'Dispute ditandai sedang ditinjau', {
        id: result.row.id,
        status: result.row.status,
        claimed_at: result.row.claimed_at,
    });
};

export const requestEvidence = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID dispute tidak valid.');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) return fail(res, 400, 'note wajib diisi.');

    const [row] = await db.select().from(dispute_table).where(eq(dispute_table.id, id)).limit(1);
    if (!row) return fail(res, 404, 'Dispute tidak ditemukan.');
    if (row.status === 'RESOLVED') return fail(res, 409, 'Dispute sudah diselesaikan.');

    const [assignment] = await db.select().from(assignment_table)
        .where(eq(assignment_table.id, row.assignment_id)).limit(1);
    if (!assignment) return fail(res, 404, 'Assignment untuk dispute ini tidak ditemukan.');

    await db.transaction(async (tx) => {
        await tx.update(dispute_table)
            .set({ status: 'IN_REVIEW', claimed_by: row.claimed_by ?? adminId, claimed_at: row.claimed_at ?? new Date() })
            .where(eq(dispute_table.id, id));

        await notify(tx, assignment.requester_id, {
            type: 'dispute.evidence_requested',
            title: 'Bukti tambahan diperlukan',
            body: note,
            data: { dispute_id: id },
        });
        await notify(tx, assignment.helper_id, {
            type: 'dispute.evidence_requested',
            title: 'Bukti tambahan diperlukan',
            body: note,
            data: { dispute_id: id },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: 'dispute.request_evidence',
            entityType: 'dispute',
            entityId: id,
            metadata: { note },
        });
    });

    return ok(res, 'Permintaan bukti tambahan dikirim', { id, status: 'IN_REVIEW' });
};

export const resolveDispute = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID dispute tidak valid.');

    const decision = req.body?.decision as 'FULL_REFUND' | 'PARTIAL_REFUND' | 'RELEASE';
    const basis = typeof req.body?.basis === 'string' ? req.body.basis.trim() : '';
    const refundAmount = req.body?.refund_amount ?? req.body?.refundAmount;

    if (!['FULL_REFUND', 'PARTIAL_REFUND', 'RELEASE'].includes(decision)) {
        return fail(res, 400, 'decision harus FULL_REFUND, PARTIAL_REFUND, atau RELEASE.');
    }
    if (!basis) return fail(res, 400, 'basis wajib diisi.');
    if (decision === 'PARTIAL_REFUND' && (typeof refundAmount !== 'number' || !Number.isInteger(refundAmount))) {
        return fail(res, 400, 'refund_amount wajib berupa integer untuk PARTIAL_REFUND.');
    }

    try {
        const result = await db.transaction(async (tx) => {
            const [dispute] = await tx.select().from(dispute_table)
                .where(eq(dispute_table.id, id)).for('update');
            if (!dispute) return { error: true as const, status: 404, message: 'Dispute tidak ditemukan.' };
            if (dispute.status === 'RESOLVED') {
                return { error: true as const, status: 409, message: 'Dispute sudah diselesaikan.' };
            }

            const [assignment] = await tx.select().from(assignment_table)
                .where(eq(assignment_table.id, dispute.assignment_id)).for('update');
            if (!assignment) return { error: true as const, status: 404, message: 'Assignment tidak ditemukan.' };

            const money = await resolveDisputeFunds(tx, {
                assignment,
                decision,
                refundAmount: typeof refundAmount === 'number' ? refundAmount : undefined,
                adminId,
                disputeId: id,
            });
            if (money.error) return money;

            const now = new Date();
            const [updated] = await tx.update(dispute_table).set({
                status: 'RESOLVED',
                decision,
                refund_amount: money.refunded,
                basis,
                resolved_by: adminId,
                resolved_at: now,
                claimed_by: dispute.claimed_by ?? adminId,
                claimed_at: dispute.claimed_at ?? now,
            }).where(eq(dispute_table.id, id)).returning();

            return {
                error: false as const,
                dispute: updated,
                refunded: money.refunded,
                released: money.released,
            };
        });

        if (result.error) return fail(res, result.status, result.message);

        return ok(res, 'Dispute berhasil diputuskan', {
            id,
            status: 'RESOLVED',
            decision,
            refund_amount: result.refunded,
            released_amount: result.released,
        });
    } catch (error) {
        if (error instanceof WalletError) return fail(res, error.status, error.message);
        throw error;
    }
};

export const exportDisputes = async (_req: Request, res: Response) => {
    const rows = await db.select({
        id: dispute_table.id,
        assignment_id: dispute_table.assignment_id,
        raised_by: dispute_table.raised_by,
        reason: dispute_table.reason,
        status: dispute_table.status,
        decision: dispute_table.decision,
        refund_amount: dispute_table.refund_amount,
        created_at: dispute_table.created_at,
        resolved_at: dispute_table.resolved_at,
    }).from(dispute_table).orderBy(desc(dispute_table.created_at));

    return sendCsv(res, 'disputes.csv', toCsv(rows));
};
