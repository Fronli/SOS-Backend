import { z } from 'zod';
import { limitParam, pageParam } from './pagination.validator';

export const suspendSchema = z.object({
    days: z.number().int().min(1).max(3650).nullable().optional(),
    reason: z.string().trim().min(1, 'reason wajib diisi').max(255),
}).strict();

export const reactivateSchema = z.object({
    reason: z.string().trim().min(1, 'reason wajib diisi').max(255),
}).strict();

export const warnSchema = z.object({
    note: z.string().trim().min(1, 'note wajib diisi').max(1000),
}).strict();

export const verificationNoteSchema = z.object({
    note: z.string().trim().max(1000).optional(),
}).passthrough();

export const verificationRejectSchema = z.object({
    note: z.string().trim().min(1, 'note wajib diisi').max(1000),
}).strict();

export const resolveReportSchema = z.object({
    action: z.string().trim().min(1, 'action wajib diisi').max(40),
    reason: z.string().trim().min(1, 'reason wajib diisi').max(1000),
}).passthrough();

export const dismissReportSchema = z.object({
    reason: z.string().trim().min(1, 'reason wajib diisi').max(1000),
}).strict();

export const moderateRequestSchema = z.object({
    action: z.enum(['HIDE', 'REMOVE', 'KEEP']),
    reason: z.string().trim().min(1, 'reason wajib diisi').max(255),
}).strict();

export const evidenceRequestSchema = z.object({
    note: z.string().trim().min(1, 'note wajib diisi').max(1000),
}).strict();

export const resolveDisputeSchema = z.object({
    decision: z.enum(['FULL_REFUND', 'PARTIAL_REFUND', 'RELEASE']),
    basis: z.string().trim().min(1, 'basis wajib diisi').max(2000),
    refund_amount: z.number().int().positive().optional(),
    refundAmount: z.number().int().positive().optional(),
}).passthrough().refine(
    (value) => value.decision !== 'PARTIAL_REFUND' || (value.refund_amount ?? value.refundAmount) !== undefined,
    { message: 'refund_amount wajib diisi untuk PARTIAL_REFUND', path: ['refund_amount'] },
);

export const fixNoteSchema = z.object({
    note: z.string().trim().min(1, 'note wajib diisi').max(1000),
}).strict();

export const auditQuerySchema = z.object({
    entityType: z.string().trim().max(40).optional(),
    entityId: z.coerce.number().int().positive().optional(),
    actorId: z.coerce.number().int().positive().optional(),
    action: z.string().trim().max(80).optional(),
    page: pageParam,
    limit: limitParam,
}).passthrough();
