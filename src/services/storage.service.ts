import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';

export type FilePurpose =
    | 'AVATAR' | 'PORTFOLIO' | 'STUDENT_ID'
    | 'REQUEST_ATTACHMENT' | 'CHAT_ATTACHMENT' | 'DISPUTE_EVIDENCE';

type PurposeRule = {
    mimes: string[];
    maxBytes: number;
    private: boolean;
};

const KB = 1024;
const MB = 1024 * KB;

export const PURPOSE_RULES: Record<FilePurpose, PurposeRule> = {
    AVATAR: { mimes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 2 * MB, private: false },
    PORTFOLIO: {
        mimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        maxBytes: 5 * MB,
        private: false,
    },
    STUDENT_ID: {
        mimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        maxBytes: 5 * MB,
        private: true,
    },
    REQUEST_ATTACHMENT: {
        mimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        maxBytes: 5 * MB,
        private: true,
    },
    CHAT_ATTACHMENT: {
        mimes: [
            'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
            'application/zip', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        maxBytes: 10 * MB,
        private: true,
    },
    DISPUTE_EVIDENCE: {
        mimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        maxBytes: 10 * MB,
        private: true,
    },
};

const EXTENSIONS: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export const PRESIGN_TTL_SECONDS = 15 * 60;

export function uploadDir(): string {
    return path.resolve(process.env.UPLOAD_DIR || 'uploads');
}

export function isPurpose(value: unknown): value is FilePurpose {
    return typeof value === 'string' && value in PURPOSE_RULES;
}

export function purposeRule(purpose: FilePurpose): PurposeRule {
    return PURPOSE_RULES[purpose];
}

export function isMimeAllowed(purpose: FilePurpose, mime: string): boolean {
    return PURPOSE_RULES[purpose].mimes.includes(mime);
}

export function extensionFor(mime: string): string {
    return EXTENSIONS[mime] ?? 'bin';
}

const KEY_PATTERN = /^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/;

export function isValidKey(key: unknown): key is string {
    return typeof key === 'string' && KEY_PATTERN.test(key);
}

export function createKey(mime: string): string {
    return `${randomUUID()}.${extensionFor(mime)}`;
}

function safePath(key: string): string | null {
    if (!isValidKey(key)) return null;
    const base = uploadDir();
    const target = path.resolve(base, key);
    return target.startsWith(base + path.sep) ? target : null;
}

export async function saveFile(key: string, data: Buffer): Promise<void> {
    const target = safePath(key);
    if (!target) throw new Error('Key file tidak valid');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
}

export async function readFile(key: string): Promise<Buffer | null> {
    const target = safePath(key);
    if (!target) return null;
    try {
        return await fs.readFile(target);
    } catch {
        return null;
    }
}

export async function removeFile(key: string): Promise<void> {
    const target = safePath(key);
    if (!target) return;
    await fs.rm(target, { force: true });
}

export function baseUrl(): string {
    const configured = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (configured) return configured;
    return `http://localhost:${process.env.PORT || 3000}`;
}

export function publicUrl(key: string): string {
    return `${baseUrl()}/api/v1/files/${key}`;
}

/** Short-lived HMAC token so admin KTM preview URLs are not permanently valid. */
export function signReadToken(key: string, ttlSeconds = 10 * 60): string {
    return jwt.sign({ key, scope: 'file-read' }, fileSecret(), { expiresIn: ttlSeconds });
}

export function verifyReadToken(key: string, token: string): boolean {
    try {
        const payload = jwt.verify(token, fileSecret()) as { key?: string; scope?: string };
        return payload.scope === 'file-read' && payload.key === key;
    } catch {
        return false;
    }
}

function fileSecret(): string {
    return process.env.FILE_URL_SECRET || process.env.JWT_SECRET || 'your_jwt_secret_key';
}

export function signedUrl(key: string, ttlSeconds?: number): string {
    return `${publicUrl(key)}?token=${signReadToken(key, ttlSeconds)}`;
}
