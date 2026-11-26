import { json } from 'express';

/**
 * Parse a route param that Express 5 may type as string | string[].
 * Returns null when the value is not a positive integer.
 */
export function parseId(param: unknown): number | null {
    const raw = Array.isArray(param) ? param[0] : param;
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) return null;
    return value;
}

export function badId(res: import('express').Response, label = 'ID') {
    return res.status(400).json({ success: false, message: `${label} tidak valid.` });
}
