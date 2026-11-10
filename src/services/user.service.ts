import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { user_table } from '../db/schema';

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
