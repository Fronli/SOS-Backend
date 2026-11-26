import { z } from 'zod';

/**
 * Pagination inputs are lenient on purpose: out-of-range or non-numeric values
 * fall back to defaults inside `parsePagination` instead of returning 400.
 */
export const pageParam = z.coerce.number().optional().catch(undefined);
export const limitParam = z.coerce.number().optional().catch(undefined);

export const paginationQuerySchema = z.object({
    page: pageParam,
    limit: limitParam,
}).passthrough();
