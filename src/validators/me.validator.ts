import { z } from 'zod';
import { limitParam, pageParam } from './pagination.validator';

const url = z.string().trim().max(255, 'URL maksimal 255 karakter').nullable().optional()
    .transform((value) => (value === '' ? null : value))
    .refine((value) => {
        if (value === null || value === undefined) return true;
        try {
            const parsed = new URL(value);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }, 'URL harus berupa HTTP/HTTPS yang valid');

const tagIds = z.array(z.number().int().positive()).max(10, 'Maksimal 10 pilihan');

export const updateMeSchema = z.object({
    full_name: z.string().trim().min(2, 'full_name minimal 2 karakter').max(255).optional(),
    university: z.string().trim().min(1, 'university minimal 1 karakter').max(255).optional(),
    major: z.string().trim().min(1, 'major minimal 1 karakter').max(255).optional(),
    linkedin_url: url,
    website: url,
}).strict();

export const interestsSchema = z.object({ tag_ids: tagIds }).strict();

export const skillsSchema = z.object({ tag_ids: tagIds }).strict();

export const avatarSchema = z.object({
    file_key: z.string().min(1, 'file_key wajib diisi'),
}).strict();

export const portfolioCreateSchema = z.object({
    title: z.string().trim().min(1, 'title wajib diisi').max(150),
    description: z.string().trim().max(2000).optional().nullable(),
    url: url,
    file_key: z.string().max(128).optional().nullable(),
    sort_order: z.number().int().min(0).max(1000).optional(),
}).strict();

export const studentVerificationSchema = z.object({
    file_key: z.string().min(1, 'file_key wajib diisi'),
}).strict();

export const listQuerySchema = z.object({
    page: pageParam,
    limit: limitParam,
    q: z.string().trim().max(100).optional(),
}).passthrough();
