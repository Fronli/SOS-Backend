import { z } from 'zod';
import { limitParam, pageParam } from './pagination.validator';

export const createConversationSchema = z.object({
    request_id: z.number().int().positive('request_id tidak valid'),
    helper_id: z.number().int().positive('helper_id tidak valid'),
}).strict();

export const sendMessageSchema = z.object({
    body: z.string().trim().max(4000, 'Pesan maksimal 4000 karakter').optional(),
    file_key: z.string().trim().max(128).optional(),
}).strict().refine((value) => Boolean(value.body) || Boolean(value.file_key), {
    message: 'Kirim body teks atau file_key',
});

export const messageQuerySchema = z.object({
    before: z.coerce.number().int().positive().optional(),
    limit: limitParam,
}).passthrough();

export const conversationQuerySchema = z.object({
    q: z.string().trim().max(100).optional(),
    page: pageParam,
    limit: limitParam,
}).passthrough();

export const markReadSchema = z.object({
    last_read_message_id: z.number().int().positive().optional(),
}).strict();
