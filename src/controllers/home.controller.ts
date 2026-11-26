import { Request, Response } from 'express';
import { and, count, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db/db';
import {
    assignment_table, conversation_table, request_table, user_table,
} from '../db/schema';
import { unreadNotificationCount } from './notification.controller';
import { unreadMessageCount } from './conversation.controller';
import { walletSummary } from './wallet.controller';
import { publicUrl } from '../services/storage.service';
import { ok } from '../utils/response.util';

/**
 * GET /me/home — Home screen summary: ongoing assignments on both sides,
 * unread counters and wallet balance.
 */
export const getHome = async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const ongoing = await db
        .select({
            id: assignment_table.id,
            request_id: assignment_table.request_id,
            status: assignment_table.status,
            amount: assignment_table.amount,
            deadline_at: assignment_table.deadline_at,
            requester_id: assignment_table.requester_id,
            helper_id: assignment_table.helper_id,
            request_title: request_table.title,
            request_status: request_table.status,
        })
        .from(assignment_table)
        .innerJoin(request_table, eq(assignment_table.request_id, request_table.id))
        .where(and(
            or(
                eq(assignment_table.requester_id, userId),
                eq(assignment_table.helper_id, userId),
            )!,
            inArray(assignment_table.status, ['PENDING_AGREEMENT', 'ON_PROGRESS', 'DISPUTED']),
        ))
        .orderBy(desc(assignment_table.updated_at))
        .limit(10);

    const counterpartIds = new Set<number>();
    for (const row of ongoing) {
        counterpartIds.add(row.requester_id === userId ? row.helper_id : row.requester_id);
    }

    const [counterparts, unreadNotifications, unreadMessages, wallet] = await Promise.all([
        counterpartIds.size > 0
            ? db.select({
                id: user_table.id,
                full_name: user_table.full_name,
                avatar_file_key: user_table.avatar_file_key,
            }).from(user_table).where(inArray(user_table.id, [...counterpartIds]))
            : Promise.resolve([]),
        unreadNotificationCount(userId),
        unreadMessageCount(userId),
        walletSummary(userId),
    ]);

    const counterpartMap = new Map(counterparts.map((person) => [person.id, person]));

    const asRequester = ongoing.filter((row) => row.requester_id === userId);
    const asHelper = ongoing.filter((row) => row.helper_id === userId);

    const shape = (row: typeof ongoing[number]) => {
        const counterpartId = row.requester_id === userId ? row.helper_id : row.requester_id;
        const person = counterpartMap.get(counterpartId);
        return {
            assignment_id: row.id,
            request: { id: row.request_id, title: row.request_title, status: row.request_status },
            status: row.status,
            amount: row.amount,
            deadline_at: row.deadline_at,
            counterpart: person ? {
                id: person.id,
                full_name: person.full_name,
                avatar_url: person.avatar_file_key ? publicUrl(person.avatar_file_key) : null,
            } : null,
        };
    };

    return ok(res, 'Ringkasan home berhasil diambil', {
        ongoing_as_requester: asRequester.map(shape),
        ongoing_as_helper: asHelper.map(shape),
        unread_notifications: unreadNotifications,
        unread_messages: unreadMessages,
        wallet,
    });
};

/** GET /me/pending-counts — lightweight badge counters for the mobile shell. */
export const getMyPendingCounts = async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const [[pendingAgreements], [pendingCompletions], unreadNotifications, unreadMessages] = await Promise.all([
        db.select({ total: count() }).from(assignment_table).where(and(
            eq(assignment_table.status, 'PENDING_AGREEMENT'),
            or(
                eq(assignment_table.requester_id, userId),
                eq(assignment_table.helper_id, userId),
            )!,
        )),
        db.select({ total: count() }).from(assignment_table).where(and(
            or(
                eq(assignment_table.requester_id, userId),
                eq(assignment_table.helper_id, userId),
            )!,
            eq(assignment_table.status, 'ON_PROGRESS'),
        )),
        unreadNotificationCount(userId),
        unreadMessageCount(userId),
    ]);

    const [openConversations] = await db
        .select({ total: count() })
        .from(conversation_table)
        .where(and(
            or(
                eq(conversation_table.requester_id, userId),
                eq(conversation_table.helper_id, userId),
            )!,
            eq(conversation_table.status, 'ACTIVE'),
        ));

    return ok(res, 'Jumlah antrean berhasil diambil', {
        pending_agreements: Number(pendingAgreements?.total ?? 0),
        on_progress: Number(pendingCompletions?.total ?? 0),
        active_conversations: Number(openConversations?.total ?? 0),
        unread_notifications: unreadNotifications,
        unread_messages: unreadMessages,
    });
};
