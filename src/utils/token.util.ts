import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** Refresh token is opaque; only its SHA-256 hash is persisted. */
export function createRefreshToken() {
    const token = randomBytes(32).toString('base64url');
    return {
        token,
        hash: hashToken(token),
        familyId: randomUUID(),
    };
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenTtlMs(days = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30)): number {
    const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
    return safeDays * 24 * 60 * 60 * 1000;
}
