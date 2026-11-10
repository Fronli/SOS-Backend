import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { user_table } from '../db/schema';

export interface JwtPayload {
    id: number;
    email: string;
    iat: number;
    exp: number;
}

// Extend Express Request to include user
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
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

/**
 * Middleware: requires authenticated user to have a verified email.
 * Must be placed AFTER authenticateToken.
 * Checks the database for email_verified_at to ensure accuracy.
 */
export const requireVerified = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Token tidak valid.',
            });
        }

        const [user] = await db
            .select({ email_verified_at: user_table.email_verified_at })
            .from(user_table)
            .where(eq(user_table.id, userId))
            .limit(1);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Akun tidak ditemukan.',
            });
        }

        if (!user.email_verified_at) {
            return res.status(403).json({
                success: false,
                message: 'Email belum terverifikasi. Silakan verifikasi OTP terlebih dahulu.',
            });
        }

        next();
    } catch {
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};
