import { Request, Response } from 'express';
import { and, avg, count, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../db/db';
import {
    assignment_table, review_table, user_skill_table, user_table, tag_table,
} from '../db/schema';
import { publicUrl } from '../services/storage.service';
import { fail, ok, paginated } from '../utils/response.util';
import { parseId } from '../utils/id.util';
import { parsePagination } from '../utils/pagination.util';
import { serializePublicProfile } from '../services/user.service';

export const getPublicUser = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID user tidak valid.');

    const profile = await serializePublicProfile(id, {
        includePortfolio: true,
        includeSkills: true,
        includeStats: true,
    });
    if (!profile) return fail(res, 404, 'Pengguna tidak ditemukan.');

    return ok(res, 'Profil pengguna berhasil diambil', profile);
};

export const getUserReviews = async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID user tidak valid.');

    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

    const [countRow] = await db
        .select({ total: count() })
        .from(review_table)
        .where(eq(review_table.helper_id, id));

    const rows = await db
        .select({
            id: review_table.id,
            rating: review_table.rating,
            comment: review_table.comment,
            created_at: review_table.created_at,
            assignment_id: review_table.assignment_id,
            reviewer: {
                id: user_table.id,
                full_name: user_table.full_name,
                university: user_table.university,
            },
        })
        .from(review_table)
        .innerJoin(user_table, eq(review_table.requester_id, user_table.id))
        .where(eq(review_table.helper_id, id))
        .orderBy(desc(review_table.created_at), desc(review_table.id))
        .limit(limit)
        .offset(offset);

    return paginated(res, 'Daftar review berhasil diambil', rows, {
        page, limit, total: Number(countRow?.total ?? 0),
    });
};

/**
 * GET /helpers — discover helpers by name, skill and activity.
 * Helpers are active users with at least one completed assignment or listed skill.
 */
export const listHelpers = async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const skillSlug = typeof req.query.skill === 'string' ? req.query.skill.trim() : '';
    const sort = req.query.sort === 'helps' ? 'helps' : 'rating';

    const completedHelps = db
        .select({
            helper_id: assignment_table.helper_id,
            completed_total: count().as('completed_total'),
        })
        .from(assignment_table)
        .where(eq(assignment_table.status, 'COMPLETED'))
        .groupBy(assignment_table.helper_id)
        .as('completed_helps');

    const ratingStats = db
        .select({
            helper_id: review_table.helper_id,
            rating_average: avg(review_table.rating).as('rating_average'),
            review_total: count().as('review_total'),
        })
        .from(review_table)
        .groupBy(review_table.helper_id)
        .as('rating_stats');

    let skillUserIds: number[] | null = null;
    if (skillSlug) {
        const rows = await db
            .select({ user_id: user_skill_table.user_id })
            .from(user_skill_table)
            .innerJoin(tag_table, eq(user_skill_table.tag_id, tag_table.id))
            .where(eq(tag_table.slug, skillSlug));
        skillUserIds = rows.map((r) => r.user_id);
        if (skillUserIds.length === 0) {
            return paginated(res, 'Daftar helper berhasil diambil', [], { page, limit, total: 0 });
        }
    }

    const matches: ReturnType<typeof eq>[] = [eq(user_table.status, 'ACTIVE')];
    if (q) {
        const escaped = q.replace(/[%_\\]/g, '\\$&');
        matches.push(or(
            ilike(user_table.full_name, `%${escaped}%`),
            ilike(user_table.university, `%${escaped}%`),
            ilike(user_table.major, `%${escaped}%`),
        )!);
    }
    if (skillUserIds) {
        matches.push(inArray(user_table.id, skillUserIds));
    }

    const whereClause = and(...matches)!;

    // Only users with completed help history or listed skills count as helpers.
    const helperSeed = db
        .select({ helper_id: assignment_table.helper_id })
        .from(assignment_table)
        .where(eq(assignment_table.status, 'COMPLETED'))
        .union(
            db.select({ helper_id: user_skill_table.user_id }).from(user_skill_table),
        );

    const [countRow] = await db
        .select({ total: count() })
        .from(user_table)
        .where(and(whereClause, inArray(user_table.id, helperSeed)));

    const baseQuery = db
        .select({
            id: user_table.id,
            full_name: user_table.full_name,
            university: user_table.university,
            major: user_table.major,
            avatar_file_key: user_table.avatar_file_key,
            student_verified_at: user_table.student_verified_at,
            rating_average: ratingStats.rating_average,
            review_count: ratingStats.review_total,
            completed_helps: completedHelps.completed_total,
        })
        .from(user_table)
        .leftJoin(ratingStats, eq(ratingStats.helper_id, user_table.id))
        .leftJoin(completedHelps, eq(completedHelps.helper_id, user_table.id))
        .where(and(whereClause, inArray(user_table.id, helperSeed)))
        .$dynamic();

    const ordered = sort === 'helps'
        ? baseQuery.orderBy(desc(completedHelps.completed_total), desc(ratingStats.rating_average))
        : baseQuery.orderBy(desc(ratingStats.rating_average), desc(completedHelps.completed_total));

    const rows = await ordered.limit(limit).offset(offset);

    return paginated(res, 'Daftar helper berhasil diambil', rows.map((row) => ({
        id: row.id,
        full_name: row.full_name,
        university: row.university,
        major: row.major,
        avatar_url: row.avatar_file_key ? publicUrl(row.avatar_file_key) : null,
        is_student_verified: Boolean(row.student_verified_at),
        rating_average: row.rating_average === null ? 0 : Math.round(Number(row.rating_average) * 10) / 10,
        review_count: Number(row.review_count ?? 0),
        completed_helps: Number(row.completed_helps ?? 0),
    })), { page, limit, total: Number(countRow?.total ?? 0) });
};
