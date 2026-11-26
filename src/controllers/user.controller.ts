import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { user_table } from '../db/schema';
import { serializePrivateProfile } from '../services/user.service';
import { fail, ok } from '../utils/response.util';

/**
 * GET /api/v1/users/me — legacy profile endpoint.
 * New clients should use GET /api/v1/me.
 */
export const getProfile = async (req: Request, res: Response) => {
    const profile = await serializePrivateProfile(req.user!.id);
    if (!profile) return fail(res, 401, 'Akun tidak ditemukan.');
    return ok(res, 'Profil berhasil diambil', profile);
};

/**
 * PATCH /api/v1/users/me — legacy profile update.
 * Validation lives in the /me schema; this path accepts the same fields.
 */
export const updateProfile = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const body = req.body || {};
    const allowedFields = ['full_name', 'university', 'major', 'linkedin_url', 'website'];

    for (const key of Object.keys(body)) {
        if (!allowedFields.includes(key)) {
            return fail(res, 400, `Field '${key}' tidak diizinkan.`);
        }
    }
    if (Object.keys(body).length === 0) {
        return fail(res, 400, 'Tidak ada field yang dikirim untuk diperbarui.');
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const key of allowedFields) {
        if (key in body) updates[key] = body[key] === '' ? null : body[key];
    }

    await db.update(user_table).set(updates).where(eq(user_table.id, userId));
    const profile = await serializePrivateProfile(userId);
    return ok(res, 'Profil berhasil diperbarui', profile);
};
