import { Request, Response } from 'express';
import { asc, ilike } from 'drizzle-orm';
import { db } from '../db/db';
import { tag_table } from '../db/schema';

/**
 * GET /api/v1/tags
 * Returns tag catalog sorted by name. Supports optional `q` query for search.
 */
export const getTags = async (req: Request, res: Response) => {
    try {
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

        let query = db
            .select({
                id: tag_table.id,
                name: tag_table.name,
                slug: tag_table.slug,
            })
            .from(tag_table)
            .$dynamic();

        if (q) {
            // Escape SQL LIKE wildcards to treat them as literal characters
            const escaped = q.replace(/[%_\\]/g, '\\$&');
            query = query.where(ilike(tag_table.name, `%${escaped}%`));
        }

        const tags = await query.orderBy(asc(tag_table.name));

        return res.status(200).json({
            success: true,
            message: 'Daftar tag berhasil diambil',
            data: tags,
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};

