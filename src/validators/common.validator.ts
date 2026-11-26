import { z } from 'zod';

export const idParamSchema = z.object({
    id: z.coerce.number().int().positive('ID tidak valid'),
}).passthrough();

export const userIdParamSchema = z.object({
    userId: z.coerce.number().int().positive('ID user tidak valid'),
}).passthrough();

