/**
 * Returns the value only when it is one of the allowed enum values.
 * Keeps invalid query input from ever reaching the database.
 */
export function enumValue<T extends readonly [string, ...string[]]>(
    allowed: T,
    value: unknown,
): T[number] | undefined {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T[number])
        : undefined;
}
