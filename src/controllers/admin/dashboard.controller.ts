import { Request, Response } from 'express';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/db';
import {
    assignment_table, dispute_table, report_table, request_table,
    student_verification_table, user_table, wallet_table, wallet_transaction_table,
} from '../../db/schema';
import { ok } from '../../utils/response.util';
import { sendCsv, toCsv } from '../../utils/csv.util';

async function collectSummary() {
    const [
        [totalUsers], [verifiedUsers], [activeHelpers], [runningRequests],
        [pendingVerifications], [openReports], [openDisputes],
        [heldRow], [successfulTopups], [pendingRefunds], [failedPayouts],
    ] = await Promise.all([
        db.select({ total: count() }).from(user_table),
        db.select({ total: count() }).from(user_table).where(sql`${user_table.student_verified_at} IS NOT NULL`),
        db.select({ total: count() }).from(user_table).where(and(
            sql`${user_table.student_verified_at} IS NOT NULL`,
            eq(user_table.status, 'ACTIVE'),
        )),
        db.select({ total: count() }).from(assignment_table)
            .where(eq(assignment_table.status, 'ON_PROGRESS')),
        db.select({ total: count() }).from(student_verification_table)
            .where(inArray(student_verification_table.status, ['PENDING', 'IN_REVIEW'])),
        db.select({ total: count() }).from(report_table)
            .where(inArray(report_table.status, ['OPEN', 'IN_REVIEW'])),
        db.select({ total: count() }).from(dispute_table)
            .where(inArray(dispute_table.status, ['OPEN', 'IN_REVIEW'])),
        db.select({ total: sql<number>`COALESCE(SUM(${wallet_table.held}), 0)` }).from(wallet_table),
        db.select({ total: count() }).from(wallet_transaction_table)
            .where(and(eq(wallet_transaction_table.type, 'TOPUP'), eq(wallet_transaction_table.status, 'SUCCESS'))),
        db.select({ total: count() }).from(wallet_transaction_table)
            .where(and(eq(wallet_transaction_table.type, 'REFUND'), eq(wallet_transaction_table.status, 'PENDING'))),
        db.select({ total: count() }).from(wallet_transaction_table)
            .where(and(eq(wallet_transaction_table.type, 'WITHDRAWAL'), eq(wallet_transaction_table.status, 'FAILED'))),
    ]);

    return {
        total_users: Number(totalUsers?.total ?? 0),
        verified_users: Number(verifiedUsers?.total ?? 0),
        active_helpers: Number(activeHelpers?.total ?? 0),
        running_requests: Number(runningRequests?.total ?? 0),
        pending_verifications: Number(pendingVerifications?.total ?? 0),
        open_reports: Number(openReports?.total ?? 0),
        open_disputes: Number(openDisputes?.total ?? 0),
        funds_held: Number(heldRow?.total ?? 0),
        successful_topups: Number(successfulTopups?.total ?? 0),
        pending_refunds: Number(pendingRefunds?.total ?? 0),
        failed_payouts: Number(failedPayouts?.total ?? 0),
    };
}

export const dashboardSummary = async (_req: Request, res: Response) => {
    return ok(res, 'Ringkasan dashboard berhasil diambil', await collectSummary());
};

export const exportDashboardSummary = async (_req: Request, res: Response) => {
    const summary = await collectSummary();
    const rows = Object.entries(summary).map(([metric, value]) => ({ metric, value }));
    rows.push({ metric: 'exported_at', value: new Date().toISOString() as unknown as number });
    return sendCsv(res, 'dashboard-summary.csv', toCsv(rows));
};

export const pendingCounts = async (_req: Request, res: Response) => {
    const [[verifications], [reports], [disputes], [requests]] = await Promise.all([
        db.select({ total: count() }).from(student_verification_table)
            .where(inArray(student_verification_table.status, ['PENDING', 'IN_REVIEW'])),
        db.select({ total: count() }).from(report_table)
            .where(inArray(report_table.status, ['OPEN', 'IN_REVIEW'])),
        db.select({ total: count() }).from(dispute_table)
            .where(inArray(dispute_table.status, ['OPEN', 'IN_REVIEW'])),
        db.select({ total: count() }).from(request_table)
            .where(and(isNull(request_table.deleted_at), eq(request_table.status, 'HIDDEN'))),
    ]);

    return ok(res, 'Jumlah antrean admin berhasil diambil', {
        verifications: Number(verifications?.total ?? 0),
        reports: Number(reports?.total ?? 0),
        disputes: Number(disputes?.total ?? 0),
        moderated_requests: Number(requests?.total ?? 0),
    });
};
