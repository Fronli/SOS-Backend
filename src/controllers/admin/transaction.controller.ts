import { Request, Response } from 'express';
import { and, count, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { db } from '../../db/db';
import { user_table, wallet_table, wallet_transaction_table } from '../../db/schema';
import { recordAudit } from '../../services/audit.service';
import { notify } from '../../services/notification.service';
import { fail, ok, paginated } from '../../utils/response.util';
import { parseId } from '../../utils/id.util';
import { parsePagination } from '../../utils/pagination.util';
import { sendCsv, toCsv } from '../../utils/csv.util';
import { enumValue } from '../../utils/enum.util';

export const listTransactions = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const type = enumValue(['TOPUP', 'WITHDRAWAL', 'HOLD', 'RELEASE', 'REFUND', 'FEE', 'ADJUSTMENT'] as const, req.query.type);
    const status = enumValue(['PENDING', 'SUCCESS', 'FAILED'] as const, req.query.status);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const date = typeof req.query.date === 'string' ? new Date(req.query.date) : null;

    const filters = [];
    if (type) filters.push(eq(wallet_transaction_table.type, type));
    if (status) filters.push(eq(wallet_transaction_table.status, status));
    if (q) {
        const escaped = q.replace(/[%_\\]/g, '\\$&');
        filters.push(ilike(user_table.full_name, `%${escaped}%`));
    }
    if (date && !Number.isNaN(date.getTime())) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        filters.push(gte(wallet_transaction_table.created_at, start));
        filters.push(lte(wallet_transaction_table.created_at, end));
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const countBase = db
        .select({ total: count() })
        .from(wallet_transaction_table)
        .innerJoin(user_table, eq(wallet_transaction_table.user_id, user_table.id))
        .$dynamic();

    const base = db
        .select({
            id: wallet_transaction_table.id,
            user: { id: user_table.id, full_name: user_table.full_name, email: user_table.email },
            type: wallet_transaction_table.type,
            status: wallet_transaction_table.status,
            amount: wallet_transaction_table.amount,
            balance_after: wallet_transaction_table.balance_after,
            held_after: wallet_transaction_table.held_after,
            reference_type: wallet_transaction_table.reference_type,
            reference_id: wallet_transaction_table.reference_id,
            note: wallet_transaction_table.note,
            created_at: wallet_transaction_table.created_at,
        })
        .from(wallet_transaction_table)
        .innerJoin(user_table, eq(wallet_transaction_table.user_id, user_table.id))
        .$dynamic();

    const [countRow] = await (whereClause ? countBase.where(whereClause) : countBase);
    const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(wallet_transaction_table.created_at), desc(wallet_transaction_table.id))
        .limit(limit)
        .offset(offset);

    return paginated(res, 'Aktivitas transaksi berhasil diambil', rows, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

export const transactionsSummary = async (req: Request, res: Response) => {
    const date = typeof req.query.date === 'string' ? new Date(req.query.date) : new Date();
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const [[held], [topups], [refunds], [payouts]] = await Promise.all([
        db.select({ total: sql<number>`COALESCE(SUM(${wallet_table.held}), 0)` }).from(wallet_table),
        db.select({
            total: count(),
            amount: sql<number>`COALESCE(SUM(${wallet_transaction_table.amount}), 0)`,
        }).from(wallet_transaction_table).where(and(
            eq(wallet_transaction_table.type, 'TOPUP'),
            eq(wallet_transaction_table.status, 'SUCCESS'),
            gte(wallet_transaction_table.created_at, start),
            lte(wallet_transaction_table.created_at, end),
        )),
        db.select({
            total: count(),
            amount: sql<number>`COALESCE(SUM(${wallet_transaction_table.amount}), 0)`,
        }).from(wallet_transaction_table).where(and(
            eq(wallet_transaction_table.type, 'REFUND'),
            eq(wallet_transaction_table.status, 'PENDING'),
        )),
        db.select({ total: count() }).from(wallet_transaction_table).where(and(
            eq(wallet_transaction_table.type, 'WITHDRAWAL'),
            eq(wallet_transaction_table.status, 'FAILED'),
        )),
    ]);

    return ok(res, 'Ringkasan transaksi hari ini berhasil diambil', {
        date: start.toISOString().slice(0, 10),
        funds_held: Number(held?.total ?? 0),
        successful_topups: {
            count: Number(topups?.total ?? 0),
            amount: Number(topups?.amount ?? 0),
        },
        pending_refunds: {
            count: Number(refunds?.total ?? 0),
            amount: Number(refunds?.amount ?? 0),
        },
        failed_payouts: Number(payouts?.total ?? 0),
    });
};

export const getTransaction = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID transaksi tidak valid.');

    const [row] = await db
        .select({
            id: wallet_transaction_table.id,
            user: { id: user_table.id, full_name: user_table.full_name, email: user_table.email },
            type: wallet_transaction_table.type,
            status: wallet_transaction_table.status,
            amount: wallet_transaction_table.amount,
            balance_after: wallet_transaction_table.balance_after,
            held_after: wallet_transaction_table.held_after,
            reference_type: wallet_transaction_table.reference_type,
            reference_id: wallet_transaction_table.reference_id,
            note: wallet_transaction_table.note,
            created_at: wallet_transaction_table.created_at,
        })
        .from(wallet_transaction_table)
        .innerJoin(user_table, eq(wallet_transaction_table.user_id, user_table.id))
        .where(eq(wallet_transaction_table.id, id))
        .limit(1);

    if (!row) return fail(res, 404, 'Transaksi tidak ditemukan.');

    // Processing history: every ledger row tied to the same reference.
    const history = await db
        .select({
            id: wallet_transaction_table.id,
            type: wallet_transaction_table.type,
            status: wallet_transaction_table.status,
            amount: wallet_transaction_table.amount,
            created_at: wallet_transaction_table.created_at,
            note: wallet_transaction_table.note,
        })
        .from(wallet_transaction_table)
        .where(and(
            eq(wallet_transaction_table.reference_type, row.reference_type),
            row.reference_id === null
                ? sql`${wallet_transaction_table.reference_id} IS NULL`
                : eq(wallet_transaction_table.reference_id, row.reference_id),
        ))
        .orderBy(desc(wallet_transaction_table.created_at));

    return ok(res, 'Detail transaksi berhasil diambil', { ...row, history });
};

export const requestFix = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID transaksi tidak valid.');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) return fail(res, 400, 'note wajib diisi.');

    const [row] = await db.select().from(wallet_transaction_table)
        .where(eq(wallet_transaction_table.id, id)).limit(1);
    if (!row) return fail(res, 404, 'Transaksi tidak ditemukan.');

    await db.transaction(async (tx) => {
        await notify(tx, row.user_id, {
            type: 'transaction.fix_requested',
            title: 'Perbaikan data diperlukan',
            body: note,
            data: { transaction_id: id },
        });
        await recordAudit(tx, {
            actorId: adminId,
            action: 'transaction.request_fix',
            entityType: 'wallet_transaction',
            entityId: id,
            metadata: { note },
        });
    });

    return ok(res, 'Permintaan perbaikan dikirim ke pengguna', { id });
};

export const retryPayout = async (req: Request, res: Response) => {
    const adminId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID transaksi tidak valid.');

    const [row] = await db.select({ id: wallet_transaction_table.id, type: wallet_transaction_table.type })
        .from(wallet_transaction_table).where(eq(wallet_transaction_table.id, id)).limit(1);
    if (!row) return fail(res, 404, 'Transaksi tidak ditemukan.');

    await recordAudit(db, {
        actorId: adminId,
        action: 'transaction.retry_payout',
        entityType: 'wallet_transaction',
        entityId: id,
        metadata: { blocked: true, reason: 'payment provider not configured' },
    });

    return res.status(501).json({
        success: false,
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'Proses ulang payout membutuhkan integrasi payment gateway yang belum dikonfigurasi.',
    });
};

export const exportTransaction = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID transaksi tidak valid.');

    const [row] = await db
        .select({
            id: wallet_transaction_table.id,
            user_email: user_table.email,
            user_name: user_table.full_name,
            type: wallet_transaction_table.type,
            status: wallet_transaction_table.status,
            amount: wallet_transaction_table.amount,
            balance_after: wallet_transaction_table.balance_after,
            held_after: wallet_transaction_table.held_after,
            reference_type: wallet_transaction_table.reference_type,
            reference_id: wallet_transaction_table.reference_id,
            note: wallet_transaction_table.note,
            created_at: wallet_transaction_table.created_at,
        })
        .from(wallet_transaction_table)
        .innerJoin(user_table, eq(wallet_transaction_table.user_id, user_table.id))
        .where(eq(wallet_transaction_table.id, id))
        .limit(1);

    if (!row) return fail(res, 404, 'Transaksi tidak ditemukan.');
    return sendCsv(res, `transaction-${id}.csv`, toCsv([row]));
};

export const exportTransactions = async (_req: Request, res: Response) => {
    const rows = await db
        .select({
            id: wallet_transaction_table.id,
            user_email: user_table.email,
            type: wallet_transaction_table.type,
            status: wallet_transaction_table.status,
            amount: wallet_transaction_table.amount,
            reference_type: wallet_transaction_table.reference_type,
            reference_id: wallet_transaction_table.reference_id,
            created_at: wallet_transaction_table.created_at,
        })
        .from(wallet_transaction_table)
        .innerJoin(user_table, eq(wallet_transaction_table.user_id, user_table.id))
        .orderBy(desc(wallet_transaction_table.created_at));

    return sendCsv(res, 'transactions.csv', toCsv(rows));
};
