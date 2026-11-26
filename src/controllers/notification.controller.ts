import { Request, Response } from 'express';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { device_token_table, notification_table } from '../db/schema';
import { fail, ok, paginated } from '../utils/response.util';
import { parseId } from '../utils/id.util';
import { parsePagination } from '../utils/pagination.util';

export const listNotifications = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const unreadOnly = req.query.unread_only === 'true';

    const filters = [eq(notification_table.user_id, userId)];
    if (unreadOnly) filters.push(isNull(notification_table.read_at));
    const whereClause = and(...filters)!;

    const [countRow] = await db.select({ total: count() }).from(notification_table).where(whereClause);
    const [unreadRow] = await db
        .select({ total: count() })
        .from(notification_table)
        .where(and(eq(notification_table.user_id, userId), isNull(notification_table.read_at)));

    const rows = await db
        .select()
        .from(notification_table)
        .where(whereClause)
        .orderBy(desc(notification_table.created_at), desc(notification_table.id))
        .limit(limit)
        .offset(offset);

    return res.status(200).json({
        success: true,
        message: 'Daftar notifikasi berhasil diambil',
        data: rows,
        meta: {
            page,
            limit,
            total: Number(countRow?.total ?? 0),
            total_pages: Math.ceil(Number(countRow?.total ?? 0) / limit) || 1,
            unread: Number(unreadRow?.total ?? 0),
        },
    });
};

export const readNotification = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, 'ID notifikasi tidak valid.');

    const [row] = await db.update(notification_table)
        .set({ read_at: new Date() })
        .where(and(eq(notification_table.id, id), eq(notification_table.user_id, userId)))
        .returning();

    if (!row) return fail(res, 404, 'Notifikasi tidak ditemukan.');
    return ok(res, 'Notifikasi ditandai sudah dibaca', row);
};

export const readAllNotifications = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const rows = await db.update(notification_table)
        .set({ read_at: new Date() })
        .where(and(eq(notification_table.user_id, userId), isNull(notification_table.read_at)))
        .returning({ id: notification_table.id });

    return ok(res, 'Semua notifikasi ditandai sudah dibaca', { updated: rows.length });
};

export const registerDevice = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { token, platform } = req.body as { token: string; platform: string };

    const [row] = await db.insert(device_token_table)
        .values({ user_id: userId, token, platform })
        .onConflictDoUpdate({
            target: device_token_table.token,
            set: { user_id: userId, platform, last_seen_at: new Date() },
        })
        .returning();

    return res.status(201).json({
        success: true,
        message: 'Token perangkat berhasil disimpan',
        data: { id: row.id, platform: row.platform, last_seen_at: row.last_seen_at },
    });
};

export async function unreadNotificationCount(userId: number): Promise<number> {
    const [row] = await db
        .select({ total: count() })
        .from(notification_table)
        .where(and(eq(notification_table.user_id, userId), isNull(notification_table.read_at)));
    return Number(row?.total ?? 0);
}
