import { z } from 'zod';

export const createReportSchema = z.object({
    target_type: z.enum(['REQUEST', 'USER']),
    target_id: z.number().int().positive(),
    reason: z.string().trim().min(10, 'reason minimal 10 karakter').max(2000),
}).strict();

export const blockSchema = z.object({
    user_id: z.number().int().positive(),
}).strict();

/**
 * A direct request either references an existing request (`request_id`) or
 * carries the fields needed to create one.
 */
export const directRequestSchema = z.object({
    request_id: z.number().int().positive('request_id tidak valid').optional(),
    title: z.string().trim().min(5, 'title minimal 5 karakter').max(150).optional(),
    description: z.string().trim().min(10, 'description minimal 10 karakter').max(10000).optional(),
    estimated_time: z.enum(['fast', 'moderate', 'extended']).optional(),
    deadline_at: z.string().optional(),
    budget_amount: z.number().int().min(0).max(2_147_483_647).optional(),
    tag_ids: z.array(z.number().int().positive()).min(1).max(5).optional(),
    message: z.string().trim().max(2000).optional(),
}).strict().refine((value) => Boolean(value.request_id) || Boolean(
    value.title && value.description && value.estimated_time
    && value.deadline_at && value.budget_amount !== undefined && value.tag_ids,
), {
    message: 'Isi request_id atau lengkapi title, description, estimated_time, deadline_at, budget_amount, dan tag_ids',
});
