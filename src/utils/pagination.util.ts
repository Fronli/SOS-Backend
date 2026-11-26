export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export type Pagination = { page: number; limit: number; offset: number };

export function parsePagination(query: Record<string, unknown>): Pagination {
    const pageRaw = parseInt(String(query.page ?? ''), 10);
    const limitRaw = parseInt(String(query.limit ?? ''), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    let limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    return { page, limit, offset: (page - 1) * limit };
}

export function parseCursor(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
