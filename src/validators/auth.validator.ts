import { z } from 'zod';

const email = z.string().trim().toLowerCase().min(1, 'Email wajib diisi').max(254).email('Format email tidak valid');
const password = z.string().min(1, 'Password wajib diisi').refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Password maksimal 72 byte',
);
const otp = z.string().regex(/^\d{6}$/, 'OTP harus 6 digit angka');

export const registerSchema = z.object({
    full_name: z.string().trim().min(1, 'full_name wajib diisi').max(255),
    email,
    password,
    university: z.string().max(255, 'university maksimal 255 karakter').optional(),
    major: z.string().max(255, 'major maksimal 255 karakter').optional(),
    linkedin_url: z.string().max(255, 'linkedin_url maksimal 255 karakter').optional(),
    website: z.string().max(255, 'website maksimal 255 karakter').optional(),
}).strict();

export const verifyEmailSchema = z.object({
    email,
    otp,
}).strict();

export const resendOtpSchema = z.object({ email }).strict();

export const loginSchema = z.object({
    email,
    password: z.string().min(1, 'Password wajib diisi'),
}).strict();

export const refreshSchema = z.object({
    refresh_token: z.string().min(1, 'refresh_token wajib diisi'),
}).strict();

export const logoutSchema = z.object({
    refresh_token: z.string().min(1, 'refresh_token wajib diisi').optional(),
}).strict();

export const forgotPasswordSchema = z.object({ email }).strict();

export const resetPasswordSchema = z.object({
    email,
    otp,
    new_password: password,
}).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
