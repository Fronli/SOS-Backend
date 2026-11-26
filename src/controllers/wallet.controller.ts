import { Request, Response } from 'express';
import { and, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { bank_account_table, wallet_table, wallet_transaction_table } from '../db/schema';
import { getOrCreateWallet } from '../services/wallet.service';
import { fail, ok, paginated } from '../utils/response.util';
import { parseId } from '../utils/id.util';
import { parsePagination } from '../utils/pagination.util';
import { enumValue } from '../utils/enum.util';

const PROVIDER_NOT_CONFIGURED = {
    code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
    message: 'Integrasi payment gateway belum dikonfigurasi. Hubungi admin.',
};

export const getWallet = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const wallet = await db.transaction((tx) => getOrCreateWallet(tx, userId));

    return ok(res, 'Saldo wallet berhasil diambil', {
        balance: wallet.balance,
        held: wallet.held,
        available: wallet.balance,
        currency: 'IDR',
        updated_at: wallet.updated_at,
    });
};

export const listTransactions = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const type = enumValue(['TOPUP', 'WITHDRAWAL', 'HOLD', 'RELEASE', 'REFUND', 'FEE', 'ADJUSTMENT'] as const, req.query.type);
    const status = enumValue(['PENDING', 'SUCCESS', 'FAILED'] as const, req.query.status);
    const dateFrom = typeof req.query.date_from === 'string' ? new Date(req.query.date_from) : null;
    const dateTo = typeof req.query.date_to === 'string' ? new Date(req.query.date_to) : null;

    const filters = [eq(wallet_transaction_table.user_id, userId)];
    if (type) filters.push(eq(wallet_transaction_table.type, type));
    if (status) filters.push(eq(wallet_transaction_table.status, status));
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) {
        filters.push(gte(wallet_transaction_table.created_at, dateFrom));
    }
    if (dateTo && !Number.isNaN(dateTo.getTime())) {
        filters.push(lte(wallet_transaction_table.created_at, dateTo));
    }
    const whereClause = and(...filters)!;

    const [countRow] = await db
        .select({ total: count() })
        .from(wallet_transaction_table)
        .where(whereClause);

    const rows = await db
        .select()
        .from(wallet_transaction_table)
        .where(whereClause)
        .orderBy(desc(wallet_transaction_table.created_at), desc(wallet_transaction_table.id))
        .limit(limit)
        .offset(offset);

    return paginated(res, 'Mutasi saldo berhasil diambil', rows, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

export const createTopup = async (_req: Request, res: Response) => {
    return fail(res, 501, PROVIDER_NOT_CONFIGURED.message, PROVIDER_NOT_CONFIGURED);
};

export const createWithdrawal = async (_req: Request, res: Response) => {
    return fail(res, 501, PROVIDER_NOT_CONFIGURED.message, PROVIDER_NOT_CONFIGURED);
};

export const listBankAccounts = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const rows = await db
        .select()
        .from(bank_account_table)
        .where(and(eq(bank_account_table.user_id, userId), isNull(bank_account_table.deleted_at)))
        .orderBy(desc(bank_account_table.is_primary), desc(bank_account_table.created_at));

    return ok(res, 'Daftar rekening berhasil diambil', rows.map((row) => ({
        id: row.id,
        bank_code: row.bank_code,
        account_number_masked: row.account_number_masked,
        account_name: row.account_name,
        is_primary: row.is_primary,
        created_at: row.created_at,
    })));
};

function maskAccountNumber(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 4) return '*'.repeat(digits.length);
    return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export const createBankAccount = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { bank_code, account_number, account_name, is_primary } = req.body as {
        bank_code: string;
        account_number: string;
        account_name: string;
        is_primary?: boolean;
    };

    const [row] = await db.transaction(async (tx) => {
        if (is_primary) {
            await tx.update(bank_account_table)
                .set({ is_primary: false })
                .where(and(eq(bank_account_table.user_id, userId), isNull(bank_account_table.deleted_at)));
        }
        const [created] = await tx.insert(bank_account_table).values({
            user_id: userId,
            bank_code,
            account_number_masked: maskAccountNumber(account_number),
            account_name,
            is_primary: is_primary ?? false,
        }).returning();
        return [created];
    });

    return res.status(201).json({
        success: true,
        message: 'Rekening berhasil ditambahkan',
        data: {
            id: row.id,
            bank_code: row.bank_code,
            account_number_masked: row.account_number_masked,
            account_name: row.account_name,
            is_primary: row.is_primary,
            created_at: row.created_at,
        },
    });
};

export const deleteBankAccount = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID rekening tidak valid.');

    const [existing] = await db.select()
        .from(bank_account_table)
        .where(and(eq(bank_account_table.id, id), eq(bank_account_table.user_id, userId), isNull(bank_account_table.deleted_at)))
        .limit(1);

    if (!existing) return fail(res, 404, 'Rekening tidak ditemukan.');

    await db.update(bank_account_table).set({ deleted_at: new Date() }).where(eq(bank_account_table.id, id));
    return res.status(204).send();
};

export const walletSummary = async (userId: number) => {
    const [row] = await db.select({ balance: wallet_table.balance, held: wallet_table.held })
        .from(wallet_table).where(eq(wallet_table.user_id, userId)).limit(1);
    return { balance: row?.balance ?? 0, held: row?.held ?? 0 };
};

export const transactionTotals = async (userId: number) => {
    const [row] = await db
        .select({
            total_in: sql<number>`COALESCE(SUM(CASE WHEN ${wallet_transaction_table.type} IN ('TOPUP','RELEASE','REFUND') THEN ${wallet_transaction_table.amount} ELSE 0 END), 0)`,
            total_out: sql<number>`COALESCE(SUM(CASE WHEN ${wallet_transaction_table.type} = 'WITHDRAWAL' THEN ${wallet_transaction_table.amount} ELSE 0 END), 0)`,
        })
        .from(wallet_transaction_table)
        .where(eq(wallet_transaction_table.user_id, userId));
    return {
        total_in: Number(row?.total_in ?? 0),
        total_out: Number(row?.total_out ?? 0),
    };
};
