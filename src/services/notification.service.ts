import { db } from '../db/db';
import { notification_table } from '../db/schema';

type DbLike = Pick<typeof db, 'insert'>;

export type NotificationInput = {
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
};

/**
 * Creates an in-app notification row. FCM/WebSocket delivery can subscribe to
 * this table later without changing callers.
 */
export async function notify(tx: DbLike, userId: number, input: NotificationInput) {
    await tx.insert(notification_table).values({
        user_id: userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? null,
    });
}

export async function notifyMany(tx: DbLike, userIds: number[], input: NotificationInput) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    await tx.insert(notification_table).values(
        unique.map((userId) => ({
            user_id: userId,
            type: input.type,
            title: input.title,
            body: input.body,
            data: input.data ?? null,
        })),
    );
}
