import { z } from 'zod';
import { limitParam, pageParam } from './pagination.validator';

export const createAssignmentSchema = z.object({
    helper_id: z.number().int().positive('helper_id tidak valid'),
    amount: z.number().int().min(0).max(2_147_483_647).optional(),
    terms: z.string().trim().max(5000).optional(),
    deadline_at: z.string().optional(),
}).strict();

export const assignmentActionSchema = z.object({
    reason: z.string().trim().max(1000).optional(),
}).strict();

export const reviewSchema = z.object({
    rating: z.number().int().min(1, 'rating minimal 1').max(5, 'rating maksimal 5'),
    comment: z.string().trim().max(2000).optional(),
}).strict();

export const disputeSchema = z.object({
    reason: z.string().trim().min(10, 'reason minimal 10 karakter').max(2000),
    evidence_keys: z.array(z.string().min(1)).max(10).optional(),
}).strict();

export const myAssignmentsQuerySchema = z.object({
    role: z.enum(['requester', 'helper']).optional(),
    status: z.enum(['PENDING_AGREEMENT', 'ON_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED']).optional(),
    page: pageParam,
    limit: limitParam,
}).passthrough();
