import { z } from 'zod';

export const createReplySchema = z.object({
    message: z.string().trim().min(1, 'message wajib diisi').max(2000, 'message maksimal 2000 karakter'),
}).strict();
