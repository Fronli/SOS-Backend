import { Router } from 'express';
import {
    dashboardSummary, exportDashboardSummary, pendingCounts,
} from '../controllers/admin/dashboard.controller';
import {
    approveVerification, claimVerification, exportVerifications,
    getVerification, listVerifications, rejectVerification,
} from '../controllers/admin/verification.controller';
import {
    exportUsers, getUserDetail, listUsers, reactivateUser, suspendUser, warnUser,
} from '../controllers/admin/user.controller';
import {
    claimReport, dismissReport, exportReports, getReport, listReports, resolveReport,
} from '../controllers/admin/report.controller';
import {
    listModeratedRequests, moderateRequest, restoreRequest,
} from '../controllers/admin/request.controller';
import {
    claimDispute, exportDisputes, getDispute, listDisputes,
    requestEvidence, resolveDispute,
} from '../controllers/admin/dispute.controller';
import {
    exportTransaction, exportTransactions, getTransaction, listTransactions,
    requestFix, retryPayout, transactionsSummary,
} from '../controllers/admin/transaction.controller';
import { listAuditLogs } from '../controllers/admin/audit.controller';
import { authenticateToken, loadCurrentUser, requireAdmin } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import {
    auditQuerySchema, dismissReportSchema, evidenceRequestSchema, fixNoteSchema,
    moderateRequestSchema, reactivateSchema, resolveDisputeSchema, resolveReportSchema,
    suspendSchema, verificationNoteSchema, verificationRejectSchema, warnSchema,
} from '../validators/admin.validator';
import { idParamSchema } from '../validators/common.validator';

const router = Router();

// Role is always re-read from the database before any admin action.
router.use(authenticateToken, loadCurrentUser, requireAdmin);

router.get('/dashboard/summary', dashboardSummary);
router.get('/dashboard/summary/export', exportDashboardSummary);
router.get('/pending-counts', pendingCounts);

router.get('/verifications', listVerifications);
router.get('/verifications/export', exportVerifications);
router.get('/verifications/:id', validate({ params: idParamSchema }), getVerification);
router.post('/verifications/:id/claim', validate({ params: idParamSchema }), claimVerification);
router.post('/verifications/:id/approve', validate({ params: idParamSchema, body: verificationNoteSchema }), approveVerification);
router.post('/verifications/:id/reject', validate({ params: idParamSchema, body: verificationRejectSchema }), rejectVerification);

router.get('/users', listUsers);
router.get('/users/export', exportUsers);
router.get('/users/:id', validate({ params: idParamSchema }), getUserDetail);
router.post('/users/:id/suspend', validate({ params: idParamSchema, body: suspendSchema }), suspendUser);
router.post('/users/:id/reactivate', validate({ params: idParamSchema, body: reactivateSchema }), reactivateUser);
router.post('/users/:id/warn', validate({ params: idParamSchema, body: warnSchema }), warnUser);

router.get('/reports', listReports);
router.get('/reports/export', exportReports);
router.get('/reports/:id', validate({ params: idParamSchema }), getReport);
router.post('/reports/:id/claim', validate({ params: idParamSchema }), claimReport);
router.post('/reports/:id/resolve', validate({ params: idParamSchema, body: resolveReportSchema }), resolveReport);
router.post('/reports/:id/dismiss', validate({ params: idParamSchema, body: dismissReportSchema }), dismissReport);

router.get('/requests', listModeratedRequests);
router.post('/requests/:id/moderate', validate({ params: idParamSchema, body: moderateRequestSchema }), moderateRequest);
router.post('/requests/:id/restore', validate({ params: idParamSchema }), restoreRequest);

router.get('/disputes', listDisputes);
router.get('/disputes/export', exportDisputes);
router.get('/disputes/:id', validate({ params: idParamSchema }), getDispute);
router.post('/disputes/:id/claim', validate({ params: idParamSchema }), claimDispute);
router.post('/disputes/:id/request-evidence', validate({ params: idParamSchema, body: evidenceRequestSchema }), requestEvidence);
router.post('/disputes/:id/resolve', validate({ params: idParamSchema, body: resolveDisputeSchema }), resolveDispute);

router.get('/transactions', listTransactions);
router.get('/transactions/export', exportTransactions);
router.get('/transactions/summary', transactionsSummary);
router.get('/transactions/:id', validate({ params: idParamSchema }), getTransaction);
router.post('/transactions/:id/request-fix', validate({ params: idParamSchema, body: fixNoteSchema }), requestFix);
router.post('/transactions/:id/retry', validate({ params: idParamSchema }), retryPayout);
router.get('/transactions/:id/export', validate({ params: idParamSchema }), exportTransaction);

router.get('/audit-logs', validate({ query: auditQuerySchema }), listAuditLogs);

export default router;
