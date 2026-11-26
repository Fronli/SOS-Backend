/** Escape a value for a CSV cell (RFC 4180). */
export function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
    const columns = headers ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
    if (columns.length === 0) return '';
    const lines = [columns.join(',')];
    for (const row of rows) {
        lines.push(columns.map((col) => csvCell(row[col])).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
}

export function sendCsv(res: import('express').Response, filename: string, csv: string) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
}
