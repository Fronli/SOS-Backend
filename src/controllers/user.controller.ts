import { Request, Response } from 'express';
import { eq, and, isNull, sql, ilike, desc, SQL, or } from 'drizzle-orm';
import { db } from '../db/db';
import { user_table } from '../db/schema';

/** Fields safe to return in user profile responses. */
const profileFields = {
    id: user_table.id,
    full_name: user_table.full_name,
    email: user_table.email,
    university: user_table.university,
    major: user_table.major,
    linkedin_url: user_table.linkedin_url,
    website: user_table.website,
    email_verified_at: user_table.email_verified_at,
    created_at: user_table.created_at,
    updated_at: user_table.updated_at,
};

/**
 * GET /api/v1/users/me
 * Returns the authenticated user's profile. Does NOT require email verification.
 */
export const getProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Token tidak valid.',
            });
        }

        const [user] = await db
            .select(profileFields)
            .from(user_table)
            .where(eq(user_table.id, userId))
            .limit(1);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Akun tidak ditemukan.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Profil berhasil diambil',
            data: user,
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};

/**
 * Validate a URL string (must be http/https, max 255 chars).
 * Returns the trimmed URL or null. Returns undefined if invalid.
 */
function validateUrl(value: unknown): string | null | undefined {
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (trimmed.length > 255) return undefined;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        return trimmed;
    } catch {
        return undefined;
    }
}

/**
 * PATCH /api/v1/users/me
 * Updates the authenticated user's profile. Requires email verification.
 */
export const updateProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Token tidak valid.',
            });
        }

        const body = req.body || {};
        const allowedFields = ['full_name', 'university', 'major', 'linkedin_url', 'website'];
        const disallowedFields = ['id', 'email', 'password', 'email_verified_at', 'created_at', 'updated_at'];

        // Check for disallowed fields
        for (const field of disallowedFields) {
            if (field in body) {
                return res.status(400).json({
                    success: false,
                    message: `Field '${field}' tidak dapat diubah melalui endpoint ini.`,
                });
            }
        }

        const updates: Record<string, unknown> = {};
        let hasUpdates = false;

        // Validate and collect updates
        for (const key of Object.keys(body)) {
            if (!allowedFields.includes(key)) {
                return res.status(400).json({
                    success: false,
                    message: `Field '${key}' tidak diizinkan.`,
                });
            }
        }

        // full_name
        if ('full_name' in body) {
            if (typeof body.full_name !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'full_name harus berupa teks.',
                });
            }
            const trimmed = body.full_name.trim();
            if (trimmed.length < 2 || trimmed.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: 'full_name harus antara 2 dan 255 karakter.',
                });
            }
            updates.full_name = trimmed;
            hasUpdates = true;
        }

        // university
        if ('university' in body) {
            if (typeof body.university !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'university harus berupa teks.',
                });
            }
            const trimmed = body.university.trim();
            if (trimmed.length < 1 || trimmed.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: 'university harus antara 1 dan 255 karakter.',
                });
            }
            updates.university = trimmed;
            hasUpdates = true;
        }

        // major
        if ('major' in body) {
            if (typeof body.major !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'major harus berupa teks.',
                });
            }
            const trimmed = body.major.trim();
            if (trimmed.length < 1 || trimmed.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: 'major harus antara 1 dan 255 karakter.',
                });
            }
            updates.major = trimmed;
            hasUpdates = true;
        }

        // linkedin_url
        if ('linkedin_url' in body) {
            const result = validateUrl(body.linkedin_url);
            if (result === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'linkedin_url harus berupa URL HTTP/HTTPS yang valid, maksimal 255 karakter, atau null.',
                });
            }
            updates.linkedin_url = result;
            hasUpdates = true;
        }

        // website
        if ('website' in body) {
            const result = validateUrl(body.website);
            if (result === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'website harus berupa URL HTTP/HTTPS yang valid, maksimal 255 karakter, atau null.',
                });
            }
            updates.website = result;
            hasUpdates = true;
        }

        if (!hasUpdates) {
            return res.status(400).json({
                success: false,
                message: 'Tidak ada field yang dikirim untuk diperbarui.',
            });
        }

        updates.updated_at = new Date();

        const [updatedUser] = await db
            .update(user_table)
            .set(updates)
            .where(eq(user_table.id, userId))
            .returning(profileFields);

        if (!updatedUser) {
            return res.status(401).json({
                success: false,
                message: 'Akun tidak ditemukan.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Profil berhasil diperbarui',
            data: updatedUser,
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};
