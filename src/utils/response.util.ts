import { Response } from 'express';

type ApiResult = {
    status: number;
    body: {
        success: boolean;
        message: string;
        data?: unknown;
        retry_after_seconds?: number;
    };
};

export function failure(status: number, message: string): ApiResult {
    return { status, body: { success: false, message } };
}

export function respond(res: Response, result: ApiResult) {
    if (result.body.retry_after_seconds) {
        res.setHeader('Retry-After', result.body.retry_after_seconds);
    }
    return res.status(result.status).json(result.body);
}
