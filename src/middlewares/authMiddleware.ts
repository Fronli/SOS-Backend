import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { user_table } from '../db/schema';

export type UserRole = 'USER' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

export interface JwtPayload {
    id: number;
    email: string;
    role?: UserRole;
    iat: number;
    exp: number;
}

export interface CurrentUser {
    id: number;
    email: string;
    role: UserRole;
    status: AccountStatus;
    email_verified_at: Date | null;
    suspended_until: Date | null;
}

// Extend Express Request to include user
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
            currentUser?: CurrentUser;
        }
    }
}

function isActivelySuspended(user: { status: AccountStatus; suspended_until: Date | null }) {
    if (user.status !== 'SUSPENDED') return false;
    // A timed suspension ends automatically once the date passes.
    if (user.suspended_until && user.suspended_until.getTime() <= Date.now()) return false;
    return true;
}

/**
 * Middleware: verifies JWT from Authorization header.
 * Sets req.user with decoded payload on success.
 * Returns 401 if token is missing/invalid.
 */
export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Token tidak ditemukan. Silakan login terlebih dahulu.',
        });
    }

    try {
        const jwtSecret = process.env.JWT_SECRET || 'your_jwt_secret_key';
        const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({
            success: false,
            message: 'Token tidak valid atau sudah kedaluwarsa.',
        });
    }
};

/** Optional auth for public endpoints that add viewer context when logged in. */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    try {
        const jwtSecret = process.env.JWT_SECRET || 'your_jwt_secret_key';
        req.user = jwt.verify(token, jwtSecret) as JwtPayload;
    } catch {
        // Ignore invalid tokens on public routes.
    }
    return next();
};

/**
 * Loads role/status from the database on every request so authorisation never
 * depends on stale token claims. Must be placed after authenticateToken.
 */
export const loadCurrentUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Token tidak valid.' });
        }

        const [user] = await db
            .select({
                id: user_table.id,
                email: user_table.email,
                role: user_table.role,
                status: user_table.status,
                email_verified_at: user_table.email_verified_at,
                suspended_until: user_table.suspended_until,
            })
            .from(user_table)
            .where(eq(user_table.id, userId))
            .limit(1);

        if (!user) {
            return res.status(401).json({ success: false, message: 'Akun tidak ditemukan.' });
        }

        if (isActivelySuspended(user)) {
            return res.status(403).json({
                success: false,
                message: 'Akun Anda sedang ditangguhkan.',
                suspended_until: user.suspended_until,
            });
        }

        req.currentUser = user;
        req.user = { ...req.user, role: user.role };
        return next();
    } catch {
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
};

/**
 * Middleware: requires an active, email-verified account.
 * Also loads the DB-backed user so suspension applies on every protected route,
 * including the ones that do not call loadCurrentUser explicitly.
 */
export const requireVerified = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Token tidak valid.' });
        }

        if (req.currentUser) {
            if (isActivelySuspended(req.currentUser)) {
                return res.status(403).json({
                    success: false,
                    message: 'Akun Anda sedang ditangguhkan.',
                    suspended_until: req.currentUser.suspended_until,
                });
            }
            if (!req.currentUser.email_verified_at) {
                return res.status(403).json({
                    success: false,
                    message: 'Email belum terverifikasi. Silakan verifikasi OTP terlebih dahulu.',
                });
            }
            return next();
        }

        const [user] = await db
            .select({
                id: user_table.id,
                email: user_table.email,
                role: user_table.role,
                status: user_table.status,
                email_verified_at: user_table.email_verified_at,
                suspended_until: user_table.suspended_until,
            })
            .from(user_table)
            .where(eq(user_table.id, userId))
            .limit(1);

        if (!user) {
            return res.status(401).json({ success: false, message: 'Akun tidak ditemukan.' });
        }

        if (isActivelySuspended(user)) {
            return res.status(403).json({
                success: false,
                message: 'Akun Anda sedang ditangguhkan.',
                suspended_until: user.suspended_until,
            });
        }

        if (!user.email_verified_at) {
            return res.status(403).json({
                success: false,
                message: 'Email belum terverifikasi. Silakan verifikasi OTP terlebih dahulu.',
            });
        }

        req.currentUser = user;
        req.user = { ...req.user, role: user.role };
        return next();
    } catch {
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
};

/** Middleware: requires the DB-backed role ADMIN. Place after loadCurrentUser. */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.currentUser?.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Akses khusus admin.' });
    }
    return next();
};
