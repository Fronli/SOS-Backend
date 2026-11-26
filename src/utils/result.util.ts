import { db } from '../db/db';

/** Drizzle transaction client type shared by services and controllers. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Discriminated result used by lookups that can fail with an HTTP status. */
export type Lookup<T> =
    | { ok: true; value: T }
    | { ok: false; status: number; message: string };

export function found<T>(value: T): Lookup<T> {
    return { ok: true, value };
}

export function notFound(message = 'Data tidak ditemukan.'): Lookup<never> {
    return { ok: false, status: 404, message };
}

export function forbidden(message = 'Anda tidak memiliki akses.'): Lookup<never> {
    return { ok: false, status: 403, message };
}
