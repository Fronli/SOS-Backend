import { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window in-memory rate limiter.
 * Per-process only; a multi-instance deployment needs a shared store.
 */
export function rateLimit(options: {
    windowMs: number;
    max: number;
    key?: (req: Request) => string;
    message?: string;
}) {
    const buckets = new Map<string, Bucket>();
    const { windowMs, max } = options;
    const message = options.message ?? 'Terlalu banyak permintaan. Silakan coba lagi nanti.';

    return (req: Request, res: Response, next: NextFunction) => {
        const key = options.key
            ? options.key(req)
            : `${req.ip || req.socket.remoteAddress || 'unknown'}:${req.path}`;
        const now = Date.now();
        const bucket = buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (bucket.count >= max) {
            const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfter);
            return res.status(429).json({
                success: false,
                message,
                retry_after_seconds: retryAfter,
            });
        }

        bucket.count += 1;

        // Opportunistic cleanup so long-running processes do not grow unbounded.
        if (buckets.size > 10_000) {
            for (const [k, v] of buckets) {
                if (v.resetAt <= now) buckets.delete(k);
            }
        }

        return next();
    };
}

/** Key by body email when available so one IP cannot spam a single account. */
export function byEmail(req: Request): string {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${req.ip || 'unknown'}:${req.path}:${email}`;
}
