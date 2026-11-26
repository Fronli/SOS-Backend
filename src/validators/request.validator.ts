import { z } from 'zod';
import { limitParam, pageParam } from './pagination.validator';

const tagIds = z.array(z.number().int().positive()).min(1, 'tag_ids minimal 1').max(5, 'tag_ids maksimal 5');

export const createRequestSchema = z.object({
    title: z.string().trim().min(5, 'title minimal 5 karakter').max(150, 'title maksimal 150 karakter'),
    description: z.string().trim().min(10, 'description minimal 10 karakter').max(10000, 'description maksimal 10000 karakter'),
    estimated_time: z.enum(['fast', 'moderate', 'extended']),
    deadline_at: z.string().refine((value) => {
        const date = new Date(value);
        return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
    }, 'deadline_at harus tanggal ISO 8601 yang valid dan di masa depan'),
    budget_amount: z.number().int().min(0).max(2_147_483_647),
    tag_ids: tagIds,
    attachment_file_keys: z.array(z.string().min(1)).max(5).optional(),
}).strict();

export const updateRequestSchema = z.object({
    title: z.string().trim().min(5, 'title minimal 5 karakter').max(150, 'title maksimal 150 karakter').optional(),
    description: z.string().trim().min(10, 'description minimal 10 karakter').max(10000, 'description maksimal 10000 karakter').optional(),
    estimated_time: z.enum(['fast', 'moderate', 'extended']).optional(),
    deadline_at: z.string().refine((value) => {
        const date = new Date(value);
        return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
    }, 'deadline_at harus tanggal ISO 8601 yang valid dan di masa depan').optional(),
    budget_amount: z.number().int().min(0).max(2_147_483_647).optional(),
    tag_ids: tagIds.optional(),
    attachment_file_keys: z.array(z.string().min(1)).max(5).optional(),
}).strict();

export const listRequestsQuerySchema = z.object({
    q: z.string().trim().max(100).optional(),
    subject: z.string().trim().max(80).optional(),
    tag_id: z.coerce.number().int().positive().optional(),
    estimated_time: z.enum(['fast', 'moderate', 'extended']).optional(),
    sort: z.enum(['newest', 'deadline', 'budget']).optional(),
    page: pageParam,
    limit: limitParam,
}).passthrough();

export const myRequestsQuerySchema = z.object({
    status: z.enum(['floating', 'on_progress', 'completed', 'cancelled']).optional(),
    q: z.string().trim().max(100).optional(),
    page: pageParam,
    limit: limitParam,
}).passthrough();

export const cancelRequestSchema = z.object({
    reason: z.string().trim().max(500).optional(),
}).strict();

