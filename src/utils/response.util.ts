import { Response } from 'express';

type ApiResult = {
    status: number;
    body: {
        success: boolean;
        message: string;
        code?: string;
        data?: unknown;
        errors?: unknown;
        [key: string]: unknown;
    };
};

export function failure(status: number, message: string): ApiResult {
    return { status, body: { success: false, message } };
}

export function respond(res: Response, result: ApiResult) {
    const retryAfter = result.body.retry_after_seconds;
    if (typeof retryAfter === 'number' && retryAfter > 0) {
        res.setHeader('Retry-After', retryAfter);
    }
    return res.status(result.status).json(result.body);
}

export function ok(res: Response, message: string, data?: unknown) {
    return res.status(200).json({ success: true, message, ...(data !== undefined ? { data } : {}) });
}

export function created(res: Response, message: string, data?: unknown) {
    return res.status(201).json({ success: true, message, ...(data !== undefined ? { data } : {}) });
}

export function fail(
    res: Response,
    status: number,
    message: string,
    extra?: Record<string, unknown>,
) {
    return res.status(status).json({ success: false, message, ...(extra || {}) });
}

export type PaginationMeta = { page: number; limit: number; total: number; total_pages?: number };

export function buildMeta(page: number, limit: number, total: number): Required<PaginationMeta> {
    return { page, limit, total, total_pages: Math.ceil(total / limit) || 1 };
}

export function paginated(
    res: Response,
    message: string,
    data: unknown[],
    meta: { page: number; limit: number; total: number },
) {
    return res.status(200).json({
        success: true,
        message,
        data,
        meta: buildMeta(meta.page, meta.limit, meta.total),
    });
}
