import { Request, Response } from 'express';
import { asc, ilike } from 'drizzle-orm';
import { db } from '../db/db';
import { tag_table } from '../db/schema';
import { ok } from '../utils/response.util';

/**
 * GET /meta/subjects — public subject catalog used by interest, create request and filters.
 */
export const listSubjects = async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    let query = db
        .select({ id: tag_table.id, name: tag_table.name, slug: tag_table.slug })
        .from(tag_table)
        .$dynamic();

    if (q) {
        const escaped = q.replace(/[%_\\]/g, '\\$&');
        query = query.where(ilike(tag_table.name, `%${escaped}%`));
    }

    const subjects = await query.orderBy(asc(tag_table.name));
    return ok(res, 'Daftar subject berhasil diambil', subjects);
};
