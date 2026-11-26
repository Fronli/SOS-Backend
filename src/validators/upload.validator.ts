import { z } from 'zod';

export const filePurposeEnum = z.enum([
    'AVATAR', 'PORTFOLIO', 'STUDENT_ID',
    'REQUEST_ATTACHMENT', 'CHAT_ATTACHMENT', 'DISPUTE_EVIDENCE',
]);

export const presignSchema = z.object({
    purpose: filePurposeEnum,
    mime: z.string().trim().min(3).max(128),
    byte_size: z.number().int().positive(),
    original_name: z.string().trim().max(255).optional(),
}).strict();
