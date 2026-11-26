import { eq, and, isNull, inArray, sql, count, avg, or } from 'drizzle-orm';
import { db } from '../db/db';
import {
    user_table, user_interest_table, user_skill_table, portfolio_table,
    tag_table, review_table, assignment_table, student_verification_table,
    block_table,
} from '../db/schema';
import { publicUrl } from './storage.service';

export type TagSummary = { id: number; name: string; slug: string };

/**
 * Get user by ID. Returns the full row (controllers should whitelist fields).
 */
export async function getUserById(id: number) {
    const [user] = await db
        .select()
        .from(user_table)
        .where(eq(user_table.id, id))
        .limit(1);
    return user ?? null;
}

export async function getTagsByIds(ids: number[]): Promise<TagSummary[]> {
    if (ids.length === 0) return [];
    return db
        .select({ id: tag_table.id, name: tag_table.name, slug: tag_table.slug })
        .from(tag_table)
        .where(inArray(tag_table.id, ids));
}

export async function getUserInterests(userId: number): Promise<TagSummary[]> {
    return db
        .select({ id: tag_table.id, name: tag_table.name, slug: tag_table.slug })
        .from(user_interest_table)
        .innerJoin(tag_table, eq(user_interest_table.tag_id, tag_table.id))
        .where(eq(user_interest_table.user_id, userId))
        .orderBy(tag_table.name);
}

export async function getUserSkills(userId: number): Promise<TagSummary[]> {
    return db
        .select({ id: tag_table.id, name: tag_table.name, slug: tag_table.slug })
        .from(user_skill_table)
        .innerJoin(tag_table, eq(user_skill_table.tag_id, tag_table.id))
        .where(eq(user_skill_table.user_id, userId))
        .orderBy(tag_table.name);
}

export async function getPortfolio(userId: number) {
    const rows = await db
        .select({
            id: portfolio_table.id,
            title: portfolio_table.title,
            description: portfolio_table.description,
            url: portfolio_table.url,
            file_key: portfolio_table.file_key,
            sort_order: portfolio_table.sort_order,
            created_at: portfolio_table.created_at,
        })
        .from(portfolio_table)
        .where(and(eq(portfolio_table.user_id, userId), isNull(portfolio_table.deleted_at)))
        .orderBy(portfolio_table.sort_order, portfolio_table.id);

    return rows.map(({ file_key, ...rest }) => ({
        ...rest,
        file_url: file_key ? publicUrl(file_key) : null,
    }));
}

export async function getReviewSummary(userId: number) {
    const [row] = await db
        .select({
            average: avg(review_table.rating),
            total: count(review_table.id),
        })
        .from(review_table)
        .where(eq(review_table.helper_id, userId));

    const average = row?.average === null || row?.average === undefined ? 0 : Number(row.average);
    return {
        rating_average: Math.round(average * 10) / 10,
        review_count: Number(row?.total ?? 0),
    };
}

export async function getCompletedHelpCount(userId: number): Promise<number> {
    const [row] = await db
        .select({ total: count() })
        .from(assignment_table)
        .where(and(
            eq(assignment_table.helper_id, userId),
            eq(assignment_table.status, 'COMPLETED'),
        ));
    return Number(row?.total ?? 0);
}

export type PublicProfileOptions = {
    includePortfolio?: boolean;
    includeInterests?: boolean;
    includeSkills?: boolean;
    includeStats?: boolean;
};

/** Public profile: never exposes email, suspension details, or password. */
export async function serializePublicProfile(userId: number, options: PublicProfileOptions = {}) {
    const [user] = await db
        .select({
            id: user_table.id,
            full_name: user_table.full_name,
            university: user_table.university,
            major: user_table.major,
            linkedin_url: user_table.linkedin_url,
            website: user_table.website,
            avatar_file_key: user_table.avatar_file_key,
            student_verified_at: user_table.student_verified_at,
            created_at: user_table.created_at,
        })
        .from(user_table)
        .where(eq(user_table.id, userId))
        .limit(1);

    if (!user) return null;

    const { avatar_file_key, student_verified_at } = user;
    const {
        includePortfolio = false, includeInterests = false,
        includeSkills = false, includeStats = true,
    } = options;

    const [interests, skills, portfolio, stats, helps] = await Promise.all([
        includeInterests ? getUserInterests(userId) : Promise.resolve(undefined),
        includeSkills ? getUserSkills(userId) : Promise.resolve(undefined),
        includePortfolio ? getPortfolio(userId) : Promise.resolve(undefined),
        includeStats ? getReviewSummary(userId) : Promise.resolve(undefined),
        includeStats ? getCompletedHelpCount(userId) : Promise.resolve(undefined),
    ]);

    return {
        id: user.id,
        full_name: user.full_name,
        university: user.university,
        major: user.major,
        linkedin_url: user.linkedin_url,
        website: user.website,
        avatar_url: avatar_file_key ? publicUrl(avatar_file_key) : null,
        is_student_verified: Boolean(student_verified_at),
        ...(stats ? { rating_average: stats.rating_average, review_count: stats.review_count } : {}),
        ...(includeStats ? { completed_helps: helps } : {}),
        ...(interests ? { interests } : {}),
        ...(skills ? { skills } : {}),
        ...(portfolio ? { portfolio } : {}),
        created_at: user.created_at,
    };
}

/** Private profile for the authenticated owner. */
export async function serializePrivateProfile(userId: number) {
    const [user] = await db
        .select({
            id: user_table.id,
            full_name: user_table.full_name,
            email: user_table.email,
            university: user_table.university,
            major: user_table.major,
            linkedin_url: user_table.linkedin_url,
            website: user_table.website,
            avatar_file_key: user_table.avatar_file_key,
            email_verified_at: user_table.email_verified_at,
            student_verified_at: user_table.student_verified_at,
            role: user_table.role,
            status: user_table.status,
            suspended_until: user_table.suspended_until,
            suspended_reason: user_table.suspended_reason,
            created_at: user_table.created_at,
            updated_at: user_table.updated_at,
        })
        .from(user_table)
        .where(eq(user_table.id, userId))
        .limit(1);

    if (!user) return null;

    const [interests, skills, portfolio, pendingVerification] = await Promise.all([
        getUserInterests(userId),
        getUserSkills(userId),
        getPortfolio(userId),
        db
            .select({
                id: student_verification_table.id,
                status: student_verification_table.status,
                created_at: student_verification_table.created_at,
            })
            .from(student_verification_table)
            .where(and(
                eq(student_verification_table.user_id, userId),
                inArray(student_verification_table.status, ['PENDING', 'IN_REVIEW']),
            ))
            .limit(1),
    ]);

    const { avatar_file_key, suspended_until, ...rest } = user;

    return {
        ...rest,
        avatar_url: avatar_file_key ? publicUrl(avatar_file_key) : null,
        is_student_verified: Boolean(user.student_verified_at),
        student_verification_pending: pendingVerification.length > 0,
        interests,
        skills,
        portfolio,
    };
}

export async function isBlockedPair(a: number, b: number): Promise<boolean> {
    const rows = await db
        .select({ blocker_id: block_table.blocker_id })
        .from(block_table)
        .where(or(
            and(eq(block_table.blocker_id, a), eq(block_table.blocked_id, b)),
            and(eq(block_table.blocker_id, b), eq(block_table.blocked_id, a)),
        ))
        .limit(1);
    return rows.length > 0;
}
