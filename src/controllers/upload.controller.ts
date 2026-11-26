import { Request, Response } from 'express';
import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/db';
import {
    assignment_table, conversation_table, dispute_evidence_table, dispute_table,
    file_table, message_table, request_attachment_table, request_table, user_table,
} from '../db/schema';
import {
    createKey, isValidKey, purposeRule, publicUrl, readFile, removeFile,
    saveFile, verifyReadToken, type FilePurpose,
} from '../services/storage.service';
import { fail, ok } from '../utils/response.util';

const PRESIGN_TTL_MS = 15 * 60 * 1000;

export const presignUpload = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { purpose, mime, byte_size, original_name } = req.body as {
        purpose: FilePurpose;
        mime: string;
        byte_size: number;
        original_name?: string;
    };

    const rule = purposeRule(purpose);
    if (!rule.mimes.includes(mime)) {
        return fail(res, 400, `Tipe file tidak diizinkan untuk ${purpose}.`, {
            allowed_mimes: rule.mimes,
        });
    }
    if (byte_size > rule.maxBytes) {
        return fail(res, 400, `Ukuran file melebihi batas ${Math.round(rule.maxBytes / 1024)} KB.`);
    }

    const key = createKey(mime);
    const expiresAt = new Date(Date.now() + PRESIGN_TTL_MS);

    await db.insert(file_table).values({
        owner_id: userId,
        key,
        purpose,
        mime,
        byte_size,
        original_name: original_name ?? null,
        expires_at: expiresAt,
    });

    return res.status(201).json({
        success: true,
        message: 'URL unggah berhasil dibuat',
        data: {
            file_key: key,
            upload_url: publicUrl(key),
            method: 'PUT',
            headers: { 'Content-Type': mime },
            expires_at: expiresAt,
            max_bytes: rule.maxBytes,
        },
    });
};

/** Direct upload used by the local storage driver (stands in for a signed S3 PUT). */
export const uploadFile = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;

    if (!isValidKey(key)) return fail(res, 400, 'Key file tidak valid.');

    const [file] = await db.select().from(file_table)
        .where(and(eq(file_table.key, key), eq(file_table.owner_id, userId)))
        .limit(1);

    if (!file) return fail(res, 404, 'File tidak ditemukan.');
    if (file.status === 'UPLOADED') return fail(res, 409, 'File sudah diunggah.');
    if (file.expires_at.getTime() <= Date.now()) return fail(res, 410, 'URL unggah sudah kedaluwarsa.');

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
        return fail(res, 400, 'Body file kosong. Kirim data biner dengan Content-Type sesuai file.');
    }
    if (body.length > file.byte_size) {
        return fail(res, 400, 'Ukuran file melebihi yang didaftarkan saat presign.');
    }

    await saveFile(file.key, body);
    const [updated] = await db.update(file_table)
        .set({ status: 'UPLOADED', uploaded_at: new Date(), byte_size: body.length })
        .where(eq(file_table.id, file.id))
        .returning();

    return ok(res, 'File berhasil diunggah', {
        file_key: updated.key,
        url: publicUrl(updated.key),
        mime: updated.mime,
        byte_size: updated.byte_size,
    });
};

/**
 * Private files are readable by:
 * - the owner,
 * - participants of the conversation the file was sent in,
 * - the requester and assigned helper of a request the file is attached to,
 * - parties of the assignment a dispute evidence file belongs to.
 * Admins use signed URLs instead of this path.
 */
async function canReadPrivateFile(userId: number, fileId: number): Promise<boolean> {
    const [message] = await db
        .select({ conversation_id: message_table.conversation_id })
        .from(message_table)
        .where(eq(message_table.file_id, fileId))
        .limit(1);

    if (message) {
        const [conversation] = await db
            .select({ requester_id: conversation_table.requester_id, helper_id: conversation_table.helper_id })
            .from(conversation_table)
            .where(eq(conversation_table.id, message.conversation_id))
            .limit(1);
        if (conversation && (conversation.requester_id === userId || conversation.helper_id === userId)) {
            return true;
        }
    }

    const [attachment] = await db
        .select({ request_id: request_attachment_table.request_id })
        .from(request_attachment_table)
        .where(eq(request_attachment_table.file_id, fileId))
        .limit(1);

    if (attachment) {
        const [request] = await db
            .select({ requester_id: request_table.requester_id })
            .from(request_table)
            .where(eq(request_table.id, attachment.request_id))
            .limit(1);
        if (request?.requester_id === userId) return true;

        const [assignment] = await db
            .select({ id: assignment_table.id })
            .from(assignment_table)
            .where(and(
                eq(assignment_table.request_id, attachment.request_id),
                eq(assignment_table.helper_id, userId),
            ))
            .limit(1);
        if (assignment) return true;

        // Any helper who replied or chatted about the request may read its attachments.
        const [conversation] = await db
            .select({ id: conversation_table.id })
            .from(conversation_table)
            .where(and(
                eq(conversation_table.request_id, attachment.request_id),
                eq(conversation_table.helper_id, userId),
            ))
            .limit(1);
        if (conversation) return true;
    }

    const [evidence] = await db
        .select({ dispute_id: dispute_evidence_table.dispute_id })
        .from(dispute_evidence_table)
        .where(eq(dispute_evidence_table.file_id, fileId))
        .limit(1);

    if (evidence) {
        const [dispute] = await db
            .select({ assignment_id: dispute_table.assignment_id })
            .from(dispute_table)
            .where(eq(dispute_table.id, evidence.dispute_id))
            .limit(1);
        if (dispute) {
            const [row] = await db
                .select({ id: assignment_table.id })
                .from(assignment_table)
                .where(and(
                    eq(assignment_table.id, dispute.assignment_id),
                    or(
                        eq(assignment_table.requester_id, userId),
                        eq(assignment_table.helper_id, userId),
                    ),
                ))
                .limit(1);
            if (row) return true;
        }
    }

    return false;
}

export const serveFile = async (req: Request, res: Response) => {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    if (!isValidKey(key)) return fail(res, 400, 'Key file tidak valid.');

    const [file] = await db.select().from(file_table).where(eq(file_table.key, key)).limit(1);
    if (!file || file.status !== 'UPLOADED') return fail(res, 404, 'File tidak ditemukan.');

    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const tokenValid = token ? verifyReadToken(key, token) : false;

    const isPublic = file.purpose === 'AVATAR' || file.purpose === 'PORTFOLIO';
    if (!isPublic && !tokenValid) {
        const userId = req.user?.id ?? null;
        if (!userId) return fail(res, 401, 'Token tidak ditemukan. Silakan login terlebih dahulu.');

        // optionalAuth does not check DB status, so verify the account here.
        const [account] = await db
            .select({ status: user_table.status, suspended_until: user_table.suspended_until })
            .from(user_table).where(eq(user_table.id, userId)).limit(1);
        if (!account) return fail(res, 401, 'Akun tidak ditemukan.');
        const suspended = account.status === 'SUSPENDED'
            && (!account.suspended_until || account.suspended_until.getTime() > Date.now());
        if (suspended) return fail(res, 403, 'Akun Anda sedang ditangguhkan.');

        if (file.owner_id !== userId) {
            const allowed = await canReadPrivateFile(userId, file.id);
            if (!allowed) return fail(res, 403, 'Anda tidak memiliki akses ke file ini.');
        }
    }

    const data = await readFile(key);
    if (!data) return fail(res, 404, 'File tidak tersedia di storage.');

    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', data.length);
    res.setHeader('Cache-Control', isPublic ? 'public, max-age=86400' : 'private, no-store');
    return res.status(200).send(data);
};

export const deleteUpload = async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    if (!isValidKey(key)) return fail(res, 400, 'Key file tidak valid.');

    const [file] = await db.select().from(file_table)
        .where(and(eq(file_table.key, key), eq(file_table.owner_id, userId)))
        .limit(1);
    if (!file) return fail(res, 404, 'File tidak ditemukan.');

    await removeFile(key);
    await db.delete(file_table).where(eq(file_table.id, file.id));
    return res.status(204).send();
};
