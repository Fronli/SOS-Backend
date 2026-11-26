import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

type Schemas = {
    body?: ZodType;
    query?: ZodType;
    params?: ZodType;
};

/**
 * Validates and replaces request parts with parsed values.
 * Zod errors become a 400 with a flat list of field errors.
 */
export function validate(schemas: Schemas) {
    return (req: Request, res: Response, next: NextFunction) => {
        const errors: { path: string; message: string }[] = [];

        for (const part of ['params', 'query', 'body'] as const) {
            const schema = schemas[part];
            if (!schema) continue;
            const result = schema.safeParse(req[part] ?? {});
            if (!result.success) {
                for (const issue of result.error.issues) {
                    errors.push({
                        path: issue.path.length ? issue.path.join('.') : part,
                        message: issue.message,
                    });
                }
                continue;
            }
            // Express 5 exposes req.query as a getter; assign explicitly.
            if (part === 'query') {
                Object.defineProperty(req, 'query', {
                    value: result.data,
                    writable: true,
                    configurable: true,
                    enumerable: true,
                });
            } else {
                (req as unknown as Record<string, unknown>)[part] = result.data;
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validasi gagal',
                errors,
            });
        }

        return next();
    };
}
