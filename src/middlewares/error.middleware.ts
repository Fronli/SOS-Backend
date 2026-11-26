import { NextFunction, Request, Response } from 'express';

export function notFoundHandler(req: Request, res: Response) {
    return res.status(404).json({
        success: false,
        message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`,
    });
}

type HttpError = Error & { status?: number; statusCode?: number; type?: string };

export function errorHandler(err: HttpError, req: Request, res: Response, _next: NextFunction) {
    const status = err.status || err.statusCode || 500;

    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, message: 'Body JSON tidak valid.' });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, message: 'Ukuran body terlalu besar.' });
    }

    if (status >= 500) {
        console.error(`${req.method} ${req.originalUrl} gagal:`, err.message);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }

    return res.status(status).json({ success: false, message: err.message || 'Permintaan gagal' });
}
