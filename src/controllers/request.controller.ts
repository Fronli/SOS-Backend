import { Request, Response } from 'express';
import {
    eq, and, isNull, sql, ilike, desc, asc, inArray, SQL, or, count,
} from 'drizzle-orm';
import { db } from '../db/db';
import {
    request_table, request_tag_table, tag_table, user_table,
    request_helper_table,
} from '../db/schema';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ESTIMATED_TIME_VALUES = ['fast', 'moderate', 'extended'] as const;
type EstimatedTime = typeof ESTIMATED_TIME_VALUES[number];

function isValidEstimatedTime(v: unknown): v is EstimatedTime {
    return typeof v === 'string' && (ESTIMATED_TIME_VALUES as readonly string[]).includes(v);
}

/** Safely parse a route param that may be string | string[] in Express 5. */
function parseParamId(param: string | string[] | undefined): number {
    const raw = Array.isArray(param) ? param[0] : param;
    return parseInt(raw ?? '', 10);
}

/** Parse ISO 8601 date string with timezone. Returns Date or null. */
function parseDeadline(v: unknown): Date | null {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d;
}

/** Parse page/limit from query, returning validated values. */
function parsePagination(query: Record<string, unknown>): { page: number; limit: number; offset: number } {
    let page = parseInt(String(query.page), 10);
    let limit = parseInt(String(query.limit), 10);
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;
    return { page, limit, offset: (page - 1) * limit };
}

/** Short requester profile for request responses. */
const requesterBriefFields = {
    id: user_table.id,
    full_name: user_table.full_name,
    university: user_table.university,
    major: user_table.major,
};

/** Escape SQL LIKE wildcards. */
function escapeLike(s: string): string {
    return s.replace(/[%_\\]/g, '\\$&');
}

/** Build tag array for a request from join results. */
async function getTagsForRequest(requestId: number) {
    return db
        .select({
            id: tag_table.id,
            name: tag_table.name,
            slug: tag_table.slug,
        })
        .from(request_tag_table)
        .innerJoin(tag_table, eq(request_tag_table.tag_id, tag_table.id))
        .where(eq(request_tag_table.request_id, requestId));
}

/** Build full request response object with tags and requester. */
async function buildRequestDetail(requestId: number) {
    const [row] = await db
        .select({
            id: request_table.id,
            requester_id: request_table.requester_id,
            title: request_table.title,
            description: request_table.description,
            estimated_time: request_table.estimated_time,
            deadline_at: request_table.deadline_at,
            budget_amount: request_table.budget_amount,
            created_at: request_table.created_at,
            updated_at: request_table.updated_at,
            requester: {
                id: user_table.id,
                full_name: user_table.full_name,
                university: user_table.university,
                major: user_table.major,
            },
        })
        .from(request_table)
        .innerJoin(user_table, eq(request_table.requester_id, user_table.id))
        .where(and(eq(request_table.id, requestId), isNull(request_table.deleted_at)))
        .limit(1);

    if (!row) return null;

    const tags = await getTagsForRequest(requestId);
    const { requester_id, requester, ...rest } = row;
    return {
        ...rest,
        is_expired: row.deadline_at.getTime() < Date.now(),
        requester,
        tags,
    };
}

/**
 * Shared logic for listing requests with filters, pagination, search.
 * If ownerIdFilter is provided, filters by requester_id = ownerIdFilter.
 */
async function listRequests(query: Record<string, unknown>, ownerIdFilter?: number) {
    const { page, limit, offset } = parsePagination(query);
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    const tagIdParam = query.tag_id;
    const estimatedTimeParam = query.estimated_time;

    // Build WHERE conditions
    const conditions: SQL[] = [isNull(request_table.deleted_at)];

    if (ownerIdFilter !== undefined) {
        conditions.push(eq(request_table.requester_id, ownerIdFilter));
    }

    if (q) {
        const escaped = escapeLike(q);
        conditions.push(
            or(
                ilike(request_table.title, `%${escaped}%`),
                ilike(request_table.description, `%${escaped}%`),
            )!
        );
    }

    if (estimatedTimeParam && isValidEstimatedTime(estimatedTimeParam)) {
        conditions.push(eq(request_table.estimated_time, estimatedTimeParam));
    }

    // If tag_id filter, join request_tag_table to filter
    let tagFilter: number | undefined;
    if (tagIdParam !== undefined) {
        const parsed = parseInt(String(tagIdParam), 10);
        if (!isNaN(parsed) && parsed > 0) {
            tagFilter = parsed;
        }
    }

    const whereClause = and(...conditions)!;

    // Use a subquery approach to avoid duplicates from many-to-many tags
    // and to get correct pagination.
    if (tagFilter) {
        // Get request IDs that have the specified tag
        const filteredIds = db
            .select({ request_id: request_tag_table.request_id })
            .from(request_tag_table)
            .where(eq(request_tag_table.tag_id, tagFilter));

        const fullWhere = and(whereClause, inArray(request_table.id, filteredIds))!;

        // Count total
        const [countResult] = await db
            .select({ total: count() })
            .from(request_table)
            .where(fullWhere);
        const total = countResult?.total ?? 0;

        // Get paginated results
        const rows = await db
            .select({
                id: request_table.id,
                requester_id: request_table.requester_id,
                title: request_table.title,
                description: request_table.description,
                estimated_time: request_table.estimated_time,
                deadline_at: request_table.deadline_at,
                budget_amount: request_table.budget_amount,
                created_at: request_table.created_at,
                updated_at: request_table.updated_at,
                requester: {
                    id: user_table.id,
                    full_name: user_table.full_name,
                    university: user_table.university,
                    major: user_table.major,
                },
            })
            .from(request_table)
            .innerJoin(user_table, eq(request_table.requester_id, user_table.id))
            .where(fullWhere)
            .orderBy(desc(request_table.created_at), desc(request_table.id))
            .limit(limit)
            .offset(offset);

        return { rows, total, page, limit };
    } else {
        // No tag filter — simpler query
        const [countResult] = await db
            .select({ total: count() })
            .from(request_table)
            .where(whereClause);
        const total = countResult?.total ?? 0;

        const rows = await db
            .select({
                id: request_table.id,
                requester_id: request_table.requester_id,
                title: request_table.title,
                description: request_table.description,
                estimated_time: request_table.estimated_time,
                deadline_at: request_table.deadline_at,
                budget_amount: request_table.budget_amount,
                created_at: request_table.created_at,
                updated_at: request_table.updated_at,
                requester: {
                    id: user_table.id,
                    full_name: user_table.full_name,
                    university: user_table.university,
                    major: user_table.major,
                },
            })
            .from(request_table)
            .innerJoin(user_table, eq(request_table.requester_id, user_table.id))
            .where(whereClause)
            .orderBy(desc(request_table.created_at), desc(request_table.id))
            .limit(limit)
            .offset(offset);

        return { rows, total, page, limit };
    }
}

/** Format list response with tags and pagination meta. */
async function formatListResponse(result: { rows: any[]; total: number; page: number; limit: number }) {
    const { rows, total, page, limit } = result;
    const totalPages = Math.ceil(total / limit) || 1;

    // Fetch tags for each request
    const data = await Promise.all(
        rows.map(async (row) => {
            const tags = await getTagsForRequest(row.id);
            const { requester_id, requester, ...rest } = row;
            return {
                ...rest,
                is_expired: row.deadline_at.getTime() < Date.now(),
                requester,
                tags,
            };
        }),
    );

    return {
        data,
        meta: {
            page,
            limit,
            total,
            total_pages: totalPages,
        },
    };
}

// ─── Disallowed fields on request body ──────────────────────────────────────
const DISALLOWED_REQUEST_FIELDS = [
    'requester_id', 'helper_id', 'status', 'response', 'max_helpers',
    'id', 'created_at', 'updated_at', 'deleted_at',
];

function checkDisallowedFields(body: Record<string, unknown>): string | null {
    for (const field of DISALLOWED_REQUEST_FIELDS) {
        if (field in body) return field;
    }
    return null;
}

// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/requests
 * Create a new job request.
 */
export const createRequest = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Token tidak valid.' });
        }

        const body = req.body || {};

        // Check disallowed fields
        const disallowed = checkDisallowedFields(body);
        if (disallowed) {
            return res.status(400).json({
                success: false,
                message: `Field '${disallowed}' tidak diizinkan.`,
            });
        }

        // Validate title
        if (typeof body.title !== 'string') {
            return res.status(400).json({ success: false, message: 'title wajib diisi.' });
        }
        const title = body.title.trim();
        if (title.length < 5 || title.length > 150) {
            return res.status(400).json({
                success: false,
                message: 'title harus antara 5 dan 150 karakter setelah trim.',
            });
        }

        // Validate description
        if (typeof body.description !== 'string') {
            return res.status(400).json({ success: false, message: 'description wajib diisi.' });
        }
        const description = body.description.trim();
        if (description.length < 10 || description.length > 10000) {
            return res.status(400).json({
                success: false,
                message: 'description harus antara 10 dan 10000 karakter setelah trim.',
            });
        }

        // Validate estimated_time
        if (!isValidEstimatedTime(body.estimated_time)) {
            return res.status(400).json({
                success: false,
                message: "estimated_time harus salah satu dari: 'fast', 'moderate', 'extended'.",
            });
        }
        const estimatedTime = body.estimated_time;

        // Validate deadline_at
        const deadline = parseDeadline(body.deadline_at);
        if (!deadline) {
            return res.status(400).json({
                success: false,
                message: 'deadline_at harus berupa tanggal ISO 8601 yang valid dengan timezone.',
            });
        }
        if (deadline.getTime() <= Date.now()) {
            return res.status(400).json({
                success: false,
                message: 'deadline_at harus di masa depan.',
            });
        }

        // Validate budget_amount
        const budget = body.budget_amount;
        if (typeof budget !== 'number' || !Number.isInteger(budget) || budget < 0 || budget > 2147483647) {
            return res.status(400).json({
                success: false,
                message: 'budget_amount harus berupa integer antara 0 dan 2147483647.',
            });
        }

        // Validate tag_ids
        const tagIds = body.tag_ids;
        if (!Array.isArray(tagIds) || tagIds.length < 1 || tagIds.length > 5) {
            return res.status(400).json({
                success: false,
                message: 'tag_ids harus berupa array dengan 1 sampai 5 ID.',
            });
        }
        // Validate uniqueness and integer type
        const uniqueTagIds = [...new Set(tagIds)];
        if (uniqueTagIds.length !== tagIds.length) {
            return res.status(400).json({
                success: false,
                message: 'tag_ids tidak boleh mengandung duplikat.',
            });
        }
        for (const id of uniqueTagIds) {
            if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Setiap tag_ids harus berupa integer positif.',
                });
            }
        }

        // Transaction: validate tags exist, insert request, insert tag links
        const result = await db.transaction(async (tx) => {
            // Check all tags exist
            const existingTags = await tx
                .select({ id: tag_table.id })
                .from(tag_table)
                .where(inArray(tag_table.id, uniqueTagIds));

            if (existingTags.length !== uniqueTagIds.length) {
                const existingIds = new Set(existingTags.map((t) => t.id));
                const missing = uniqueTagIds.filter((id) => !existingIds.has(id));
                return {
                    error: true as const,
                    status: 400,
                    message: `Tag dengan ID ${missing.join(', ')} tidak ditemukan.`,
                };
            }

            // Insert request
            const [newRequest] = await tx
                .insert(request_table)
                .values({
                    requester_id: userId,
                    title,
                    description,
                    estimated_time: estimatedTime,
                    deadline_at: deadline,
                    budget_amount: budget,
                })
                .returning();

            // Insert tag links
            await tx.insert(request_tag_table).values(
                uniqueTagIds.map((tagId) => ({
                    request_id: newRequest.id,
                    tag_id: tagId,
                })),
            );

            return { error: false as const, request: newRequest };
        });

        if (result.error) {
            return res.status(result.status).json({
                success: false,
                message: result.message,
            });
        }

        // Build full response with tags
        const detail = await buildRequestDetail(result.request.id);

        return res.status(201).json({
            success: true,
            message: 'Request pekerjaan berhasil dibuat',
            data: detail,
        });
    } catch (error) {
        console.error('Create request gagal');
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};

/**
 * GET /api/v1/requests
 * List all non-deleted requests with filters and pagination.
 */
export const listRequests_ = async (req: Request, res: Response) => {
    try {
        const result = await listRequests(req.query as Record<string, unknown>);
        const formatted = await formatListResponse(result);

        return res.status(200).json({
            success: true,
            message: 'Daftar request berhasil diambil',
            ...formatted,
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};

/**
 * GET /api/v1/requests/:id
 * Get a single request detail.
 */
export const getRequest = async (req: Request, res: Response) => {
    try {
        const id = parseParamId(req.params.id);
        if (isNaN(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: 'ID request tidak valid.',
            });
        }

        const detail = await buildRequestDetail(id);
        if (!detail) {
            return res.status(404).json({
                success: false,
                message: 'Request tidak ditemukan.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Detail request berhasil diambil',
            data: detail,
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};

/**
 * GET /api/v1/users/me/requests
 * List the authenticated user's own requests.
 */
export const listMyRequests = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Token tidak valid.' });
        }

        const result = await listRequests(req.query as Record<string, unknown>, userId);
        const formatted = await formatListResponse(result);

        return res.status(200).json({
            success: true,
            message: 'Daftar request Anda berhasil diambil',
            ...formatted,
        });
    } catch {
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};

/**
 * PATCH /api/v1/requests/:id
 * Update own request. Rejected if helpers are already assigned.
 */
export const updateRequest = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Token tidak valid.' });
        }

        const id = parseParamId(req.params.id);
        if (isNaN(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: 'ID request tidak valid.',
            });
        }

        const body = req.body || {};

        // Check disallowed fields
        const disallowed = checkDisallowedFields(body);
        if (disallowed) {
            return res.status(400).json({
                success: false,
                message: `Field '${disallowed}' tidak diizinkan.`,
            });
        }

        const allowedFields = ['title', 'description', 'estimated_time', 'deadline_at', 'budget_amount', 'tag_ids'];

        // Check for unknown fields
        for (const key of Object.keys(body)) {
            if (!allowedFields.includes(key)) {
                return res.status(400).json({
                    success: false,
                    message: `Field '${key}' tidak diizinkan.`,
                });
            }
        }

        // Check empty body
        const sentFields = Object.keys(body).filter((k) => allowedFields.includes(k));
        if (sentFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Tidak ada field yang dikirim untuk diperbarui.',
            });
        }

        // Validate individual fields
        const updates: Record<string, unknown> = {};
        let newTagIds: number[] | undefined;

        if ('title' in body) {
            if (typeof body.title !== 'string') {
                return res.status(400).json({ success: false, message: 'title harus berupa teks.' });
            }
            const trimmed = body.title.trim();
            if (trimmed.length < 5 || trimmed.length > 150) {
                return res.status(400).json({
                    success: false,
                    message: 'title harus antara 5 dan 150 karakter setelah trim.',
                });
            }
            updates.title = trimmed;
        }

        if ('description' in body) {
            if (typeof body.description !== 'string') {
                return res.status(400).json({ success: false, message: 'description harus berupa teks.' });
            }
            const trimmed = body.description.trim();
            if (trimmed.length < 10 || trimmed.length > 10000) {
                return res.status(400).json({
                    success: false,
                    message: 'description harus antara 10 dan 10000 karakter setelah trim.',
                });
            }
            updates.description = trimmed;
        }

        if ('estimated_time' in body) {
            if (!isValidEstimatedTime(body.estimated_time)) {
                return res.status(400).json({
                    success: false,
                    message: "estimated_time harus salah satu dari: 'fast', 'moderate', 'extended'.",
                });
            }
            updates.estimated_time = body.estimated_time;
        }

        if ('deadline_at' in body) {
            const deadline = parseDeadline(body.deadline_at);
            if (!deadline) {
                return res.status(400).json({
                    success: false,
                    message: 'deadline_at harus berupa tanggal ISO 8601 yang valid dengan timezone.',
                });
            }
            if (deadline.getTime() <= Date.now()) {
                return res.status(400).json({
                    success: false,
                    message: 'deadline_at harus di masa depan.',
                });
            }
            updates.deadline_at = deadline;
        }

        if ('budget_amount' in body) {
            const budget = body.budget_amount;
            if (typeof budget !== 'number' || !Number.isInteger(budget) || budget < 0 || budget > 2147483647) {
                return res.status(400).json({
                    success: false,
                    message: 'budget_amount harus berupa integer antara 0 dan 2147483647.',
                });
            }
            updates.budget_amount = budget;
        }

        if ('tag_ids' in body) {
            const tagIds = body.tag_ids;
            if (!Array.isArray(tagIds) || tagIds.length < 1 || tagIds.length > 5) {
                return res.status(400).json({
                    success: false,
                    message: 'tag_ids harus berupa array dengan 1 sampai 5 ID.',
                });
            }
            const uniqueIds = [...new Set(tagIds)];
            if (uniqueIds.length !== tagIds.length) {
                return res.status(400).json({
                    success: false,
                    message: 'tag_ids tidak boleh mengandung duplikat.',
                });
            }
            for (const tagId of uniqueIds) {
                if (typeof tagId !== 'number' || !Number.isInteger(tagId) || tagId < 1) {
                    return res.status(400).json({
                        success: false,
                        message: 'Setiap tag_ids harus berupa integer positif.',
                    });
                }
            }
            newTagIds = uniqueIds;
        }

        // Transaction: lock row, check ownership, check helpers, update
        const result = await db.transaction(async (tx) => {
            // Lock the request row
            const [existing] = await tx
                .select({
                    id: request_table.id,
                    requester_id: request_table.requester_id,
                    deleted_at: request_table.deleted_at,
                })
                .from(request_table)
                .where(eq(request_table.id, id))
                .for('update');

            if (!existing || existing.deleted_at) {
                return { error: true as const, status: 404, message: 'Request tidak ditemukan.' };
            }

            if (existing.requester_id !== userId) {
                return { error: true as const, status: 403, message: 'Anda tidak memiliki akses untuk mengubah request ini.' };
            }

            // Check if helpers are assigned
            const [helperCount] = await tx
                .select({ total: count() })
                .from(request_helper_table)
                .where(eq(request_helper_table.request_id, id));

            if (helperCount && helperCount.total > 0) {
                return {
                    error: true as const,
                    status: 409,
                    message: 'Request tidak dapat diubah karena sudah memiliki helper yang ditugaskan.',
                };
            }

            // Validate tags if provided
            if (newTagIds) {
                const existingTags = await tx
                    .select({ id: tag_table.id })
                    .from(tag_table)
                    .where(inArray(tag_table.id, newTagIds));

                if (existingTags.length !== newTagIds.length) {
                    const existingIds = new Set(existingTags.map((t) => t.id));
                    const missing = newTagIds.filter((tid) => !existingIds.has(tid));
                    return {
                        error: true as const,
                        status: 400,
                        message: `Tag dengan ID ${missing.join(', ')} tidak ditemukan.`,
                    };
                }

                // Replace all tags
                await tx.delete(request_tag_table).where(eq(request_tag_table.request_id, id));
                await tx.insert(request_tag_table).values(
                    newTagIds.map((tagId) => ({ request_id: id, tag_id: tagId })),
                );
            }

            // Update the request
            if (Object.keys(updates).length > 0) {
                updates.updated_at = new Date();
                await tx
                    .update(request_table)
                    .set(updates)
                    .where(eq(request_table.id, id));
            } else if (newTagIds) {
                // Tags changed but no other fields — still update updated_at
                await tx
                    .update(request_table)
                    .set({ updated_at: new Date() })
                    .where(eq(request_table.id, id));
            }

            return { error: false as const };
        });

        if (result.error) {
            return res.status(result.status).json({
                success: false,
                message: result.message,
            });
        }

        const detail = await buildRequestDetail(id);

        return res.status(200).json({
            success: true,
            message: 'Request berhasil diperbarui',
            data: detail,
        });
    } catch {
        console.error('Update request gagal');
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};

/**
 * DELETE /api/v1/requests/:id
 * Soft-delete own request. Rejected if helpers assigned.
 */
export const deleteRequest = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Token tidak valid.' });
        }

        const id = parseParamId(req.params.id);
        if (isNaN(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: 'ID request tidak valid.',
            });
        }

        const result = await db.transaction(async (tx) => {
            const [existing] = await tx
                .select({
                    id: request_table.id,
                    requester_id: request_table.requester_id,
                    deleted_at: request_table.deleted_at,
                })
                .from(request_table)
                .where(eq(request_table.id, id))
                .for('update');

            if (!existing || existing.deleted_at) {
                return { error: true as const, status: 404, message: 'Request tidak ditemukan.' };
            }

            if (existing.requester_id !== userId) {
                return { error: true as const, status: 403, message: 'Anda tidak memiliki akses untuk menghapus request ini.' };
            }

            // Check if helpers are assigned
            const [helperCount] = await tx
                .select({ total: count() })
                .from(request_helper_table)
                .where(eq(request_helper_table.request_id, id));

            if (helperCount && helperCount.total > 0) {
                return {
                    error: true as const,
                    status: 409,
                    message: 'Request tidak dapat dihapus karena sudah memiliki helper yang ditugaskan.',
                };
            }

            const now = new Date();
            await tx
                .update(request_table)
                .set({ deleted_at: now, updated_at: now })
                .where(eq(request_table.id, id));

            return { error: false as const };
        });

        if (result.error) {
            return res.status(result.status).json({
                success: false,
                message: result.message,
            });
        }

        return res.status(204).send();
    } catch {
        console.error('Delete request gagal');
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan pada server',
        });
    }
};
