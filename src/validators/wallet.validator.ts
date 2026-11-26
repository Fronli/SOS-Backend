import { z } from 'zod';
import { limitParam, pageParam } from './pagination.validator';

export const transactionQuerySchema = z.object({
    page: pageParam,
    limit: limitParam,
    type: z.enum(['TOPUP', 'WITHDRAWAL', 'HOLD', 'RELEASE', 'REFUND', 'FEE', 'ADJUSTMENT']).optional(),
    status: z.enum(['PENDING', 'SUCCESS', 'FAILED']).optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
}).passthrough();

export const listQuerySchema = z.object({
    page: pageParam,
    limit: limitParam,
    unread_only: z.enum(['true', 'false']).optional(),
}).passthrough();

export const bankAccountSchema = z.object({
    bank_code: z.string().trim().min(1, 'bank_code wajib diisi').max(20),
    account_number: z.string().trim().regex(/^\d{6,20}$/, 'Nomor rekening harus 6-20 digit angka'),
    account_name: z.string().trim().min(1, 'account_name wajib diisi').max(255),
    is_primary: z.boolean().optional(),
}).strict();

export const deviceSchema = z.object({
    token: z.string().trim().min(1, 'token wajib diisi').max(255),
    platform: z.enum(['android', 'ios', 'web']),
}).strict();

export const topupSchema = z.object({
    amount: z.number().int().min(10_000, 'Minimal top up Rp10.000').max(100_000_000),
    method: z.string().trim().min(1).max(50),
}).strict();

export const withdrawalSchema = z.object({
    amount: z.number().int().min(10_000, 'Minimal penarikan Rp10.000').max(100_000_000),
    bank_account_id: z.number().int().positive(),
}).strict();
