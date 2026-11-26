import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/db';
import {
    password_reset_otp_table,
    refresh_token_table,
    registration_otp_table,
    user_table,
} from '../db/schema';
import { EmailDeliveryError, sendPasswordResetOtp, sendRegistrationOtp } from '../services/mail.service';
import {
    createPasswordResetOtp,
    createRegistrationOtp,
    PASSWORD_RESET_OTP_MAX_ATTEMPTS,
    PASSWORD_RESET_OTP_RESEND_SECONDS,
    PASSWORD_RESET_OTP_TTL_SECONDS,
    REGISTER_OTP_MAX_ATTEMPTS,
    REGISTER_OTP_RESEND_SECONDS,
    REGISTER_OTP_TTL_SECONDS,
} from '../services/otp.service';
import { recordAudit } from '../services/audit.service';
import { createRefreshToken, hashToken, refreshTokenTtlMs } from '../utils/token.util';
import { respond, failure } from '../utils/response.util';

type AuthResult = {
    status: number;
    body: {
        success: boolean;
        message: string;
        data?: unknown;
        retry_after_seconds?: number;
    };
};

const publicUserFields = {
    id: user_table.id,
    full_name: user_table.full_name,
    email: user_table.email,
    university: user_table.university,
    major: user_table.major,
    linkedin_url: user_table.linkedin_url,
    website: user_table.website,
    email_verified_at: user_table.email_verified_at,
    role: user_table.role,
    status: user_table.status,
    created_at: user_table.created_at,
    updated_at: user_table.updated_at,
};

// Match older accounts that were saved before email normalization was introduced.
function matchesEmail(email: string) {
    return sql`lower(${user_table.email}) = ${email}`;
}

function handleAuthError(res: Response, error: unknown, operation: string) {
    if (error instanceof EmailDeliveryError) {
        return respond(res, failure(503, 'Email OTP gagal dikirim. Silakan coba lagi nanti.'));
    }
    // SQL/email errors can contain sensitive parameters; log only the operation.
    console.error(`${operation} gagal`);
    return respond(res, failure(500, 'Terjadi kesalahan pada server'));
}

function accessTokenTtlSeconds(): number {
    const raw = process.env.ACCESS_TOKEN_TTL || '1h';
    const match = /^(\d+)([smhd])$/.exec(raw.trim());
    if (!match) return 3600;
    const value = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return value * multiplier;
}

function signAccessToken(user: { id: number; email: string; role: 'USER' | 'ADMIN' }) {
    const jwtSecret = process.env.JWT_SECRET || 'your_jwt_secret_key';
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        jwtSecret,
        { expiresIn: accessTokenTtlSeconds() },
    );
}

async function issueRefreshToken(
    tx: Pick<typeof db, 'insert'>,
    userId: number,
    userAgent: string | null,
    familyId?: string,
) {
    const generated = createRefreshToken();
    const expiresAt = new Date(Date.now() + refreshTokenTtlMs());
    const [row] = await tx.insert(refresh_token_table).values({
        user_id: userId,
        family_id: familyId ?? generated.familyId,
        token_hash: generated.hash,
        expires_at: expiresAt,
        user_agent: userAgent,
    }).returning();
    return { token: generated.token, row };
}

function userAgentOf(req: Request): string | null {
    const value = req.headers['user-agent'];
    return typeof value === 'string' ? value.slice(0, 255) : null;
}

export const register = async (req: Request, res: Response) => {
    try {
        const body = req.body || {};
        const password: string = body.password;
        const email: string = body.email;
        const fullName: string = body.full_name;

        const profile: Record<string, string> = {};
        for (const field of ['university', 'major', 'linkedin_url', 'website'] as const) {
            profile[field] = body[field] || '';
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            const [existingUser] = await tx.select({ id: user_table.id }).from(user_table)
                .where(matchesEmail(email)).limit(1);
            if (existingUser) {
                return failure(409, 'Email sudah terdaftar. Gunakan kirim ulang OTP jika belum terverifikasi.');
            }

            const [newUser] = await tx.insert(user_table).values({
                full_name: fullName,
                email,
                password: hashedPassword,
                university: profile.university,
                major: profile.major,
                linkedin_url: profile.linkedin_url,
                website: profile.website,
                email_verified_at: null,
            }).onConflictDoNothing({ target: user_table.email }).returning(publicUserFields);

            if (!newUser) return failure(409, 'Email sudah terdaftar');

            const code = await createRegistrationOtp();
            await tx.insert(registration_otp_table).values({
                user_id: newUser.id,
                otp_hash: code.otpHash,
                expires_at: code.expiresAt,
                last_sent_at: code.sentAt,
            });
            // A delivery failure rolls back both the account and OTP.
            await sendRegistrationOtp(email, code.otp);

            return {
                status: 201,
                body: {
                    success: true,
                    message: 'Registrasi berhasil. Periksa email Anda untuk verifikasi OTP.',
                    data: { ...newUser, requires_verification: true, otp_expires_in: REGISTER_OTP_TTL_SECONDS },
                },
            };
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, 'Registrasi');
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const email: string = req.body.email;
        const otp: string = req.body.otp;

        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            // Verification and resend lock the same account to serialize OTP changes.
            const [user] = await tx.select().from(user_table).where(matchesEmail(email)).limit(1).for('update');
            if (!user) return failure(400, 'Email atau OTP tidak valid');
            if (user.email_verified_at) return failure(409, 'Email sudah terverifikasi. Silakan login.');

            const [record] = await tx.select().from(registration_otp_table)
                .where(eq(registration_otp_table.user_id, user.id)).limit(1);
            if (!record) return failure(400, 'OTP tidak ditemukan. Silakan kirim ulang OTP.');
            if (record.attempts >= REGISTER_OTP_MAX_ATTEMPTS) {
                return failure(429, 'Batas percobaan OTP tercapai. Silakan kirim ulang OTP.');
            }
            if (record.expires_at.getTime() <= Date.now()) {
                return failure(400, 'OTP sudah kedaluwarsa. Silakan kirim ulang OTP.');
            }

            const valid = await bcrypt.compare(otp, record.otp_hash);
            // Recheck after hashing so an OTP cannot be accepted after its deadline.
            if (record.expires_at.getTime() <= Date.now()) {
                return failure(400, 'OTP sudah kedaluwarsa. Silakan kirim ulang OTP.');
            }
            if (!valid) {
                const attempts = record.attempts + 1;
                await tx.update(registration_otp_table).set({ attempts })
                    .where(eq(registration_otp_table.user_id, user.id));
                // Return instead of throwing so failed attempts are committed.
                return failure(attempts >= REGISTER_OTP_MAX_ATTEMPTS ? 429 : 400,
                    attempts >= REGISTER_OTP_MAX_ATTEMPTS
                        ? 'Batas percobaan OTP tercapai. Silakan kirim ulang OTP.'
                        : 'OTP tidak valid');
            }

            const now = new Date();
            const [verifiedUser] = await tx.update(user_table)
                .set({ email_verified_at: now, updated_at: now })
                .where(eq(user_table.id, user.id)).returning(publicUserFields);
            await tx.delete(registration_otp_table).where(eq(registration_otp_table.user_id, user.id));

            return {
                status: 200,
                body: { success: true, message: 'Email berhasil diverifikasi. Silakan login.', data: verifiedUser },
            };
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, 'Verifikasi OTP');
    }
};

export const resendOtp = async (req: Request, res: Response) => {
    try {
        const email: string = req.body.email;

        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            const [user] = await tx.select().from(user_table).where(matchesEmail(email)).limit(1).for('update');
            if (!user) return failure(400, 'Email belum terdaftar');
            if (user.email_verified_at) return failure(409, 'Email sudah terverifikasi. Silakan login.');

            const [record] = await tx.select().from(registration_otp_table)
                .where(eq(registration_otp_table.user_id, user.id)).limit(1);
            const retryAfter = record
                ? Math.ceil((record.last_sent_at.getTime() + REGISTER_OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000)
                : 0;
            if (retryAfter > 0) {
                return {
                    status: 429,
                    body: { success: false, message: 'Tunggu sebelum mengirim ulang OTP.', retry_after_seconds: retryAfter },
                };
            }

            const code = await createRegistrationOtp();
            await tx.insert(registration_otp_table).values({
                user_id: user.id,
                otp_hash: code.otpHash,
                expires_at: code.expiresAt,
                last_sent_at: code.sentAt,
                attempts: 0,
            }).onConflictDoUpdate({
                target: registration_otp_table.user_id,
                set: { otp_hash: code.otpHash, expires_at: code.expiresAt, last_sent_at: code.sentAt, attempts: 0 },
            });
            // Keep the previous code and cooldown if sending the replacement fails.
            await sendRegistrationOtp(user.email, code.otp);

            return {
                status: 200,
                body: { success: true, message: 'OTP baru telah dikirim ke email Anda.', data: { otp_expires_in: REGISTER_OTP_TTL_SECONDS } },
            };
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, 'Kirim ulang OTP');
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const email: string = req.body.email;
        const password: string = req.body.password;

        const [user] = await db.select().from(user_table).where(matchesEmail(email)).limit(1);
        if (!user || !await bcrypt.compare(password, user.password)) {
            return respond(res, failure(401, 'Email atau password salah'));
        }
        if (!user.email_verified_at) {
            return respond(res, failure(403, 'Email belum terverifikasi. Silakan verifikasi email terlebih dahulu.'));
        }

        const suspended = user.status === 'SUSPENDED'
            && (!user.suspended_until || user.suspended_until.getTime() > Date.now());
        if (suspended) {
            res.setHeader('X-Account-Status', 'SUSPENDED');
            return res.status(403).json({
                success: false,
                message: 'Akun Anda sedang ditangguhkan.',
                suspended_until: user.suspended_until,
                suspended_reason: user.suspended_reason,
            });
        }

        const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role });
        const refresh = await issueRefreshToken(db, user.id, userAgentOf(req));

        const now = new Date();
        await db.update(user_table).set({ last_login_at: now }).where(eq(user_table.id, user.id));

        const { password: _pw, suspended_reason: _sr, ...safeUser } = user;

        return res.status(200).json({
            success: true,
            message: 'Login berhasil',
            data: {
                user: { ...safeUser, last_login_at: now },
                token: accessToken,
                access_token: accessToken,
                refresh_token: refresh.token,
                token_type: 'Bearer',
                expires_in: accessTokenTtlSeconds(),
                role: user.role,
            },
        });
    } catch (error) {
        return handleAuthError(res, error, 'Login');
    }
};

export const refresh = async (req: Request, res: Response) => {
    try {
        const token: string = req.body.refresh_token;
        const tokenHash = hashToken(token);

        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            const [row] = await tx.select().from(refresh_token_table)
                .where(eq(refresh_token_table.token_hash, tokenHash)).limit(1).for('update');

            if (!row) {
                return failure(401, 'Refresh token tidak valid.');
            }

            // Reuse detection: a revoked token means the family may be compromised.
            if (row.revoked_at) {
                await tx.update(refresh_token_table)
                    .set({ revoked_at: new Date() })
                    .where(and(eq(refresh_token_table.family_id, row.family_id), isNull(refresh_token_table.revoked_at)));
                await recordAudit(tx, {
                    actorId: row.user_id,
                    action: 'auth.refresh_reuse',
                    entityType: 'refresh_token',
                    entityId: row.id,
                });
                return failure(401, 'Refresh token sudah digunakan. Silakan login kembali.');
            }

            if (row.expires_at.getTime() <= Date.now()) {
                return failure(401, 'Refresh token sudah kedaluwarsa. Silakan login kembali.');
            }

            const [user] = await tx.select().from(user_table)
                .where(eq(user_table.id, row.user_id)).limit(1);
            if (!user) return failure(401, 'Akun tidak ditemukan.');

            const suspended = user.status === 'SUSPENDED'
                && (!user.suspended_until || user.suspended_until.getTime() > Date.now());
            if (suspended) {
                return failure(403, 'Akun Anda sedang ditangguhkan.');
            }

            const rotated = await issueRefreshToken(tx, user.id, userAgentOf(req), row.family_id);
            await tx.update(refresh_token_table)
                .set({ revoked_at: new Date(), replaced_by_id: rotated.row.id })
                .where(eq(refresh_token_table.id, row.id));

            const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role });

            return {
                status: 200,
                body: {
                    success: true,
                    message: 'Token berhasil diperbarui.',
                    data: {
                        token: accessToken,
                        access_token: accessToken,
                        refresh_token: rotated.token,
                        token_type: 'Bearer',
                        expires_in: accessTokenTtlSeconds(),
                        role: user.role,
                    },
                },
            };
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, 'Refresh token');
    }
};

export const logout = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) return respond(res, failure(401, 'Token tidak valid.'));

        const token = req.body?.refresh_token;
        if (typeof token === 'string' && token) {
            await db.update(refresh_token_table)
                .set({ revoked_at: new Date() })
                .where(and(eq(refresh_token_table.token_hash, hashToken(token)), eq(refresh_token_table.user_id, userId)));
        } else {
            // Without a token, revoke every session for this user.
            await db.update(refresh_token_table)
                .set({ revoked_at: new Date() })
                .where(and(eq(refresh_token_table.user_id, userId), isNull(refresh_token_table.revoked_at)));
        }

        return respond(res, {
            status: 200,
            body: { success: true, message: 'Logout berhasil. Refresh token dicabut.' },
        });
    } catch (error) {
        return handleAuthError(res, error, 'Logout');
    }
};

export const forgotPassword = async (req: Request, res: Response) => {
    try {
        const email: string = req.body.email;

        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            const [user] = await tx.select().from(user_table).where(matchesEmail(email)).limit(1).for('update');

            // Do not reveal whether an account exists.
            const generic = {
                status: 200,
                body: {
                    success: true,
                    message: 'Jika email terdaftar, kode OTP reset password telah dikirim.',
                    data: { otp_expires_in: PASSWORD_RESET_OTP_TTL_SECONDS },
                },
            } as AuthResult;

            if (!user || !user.email_verified_at) return generic;

            const [record] = await tx.select().from(password_reset_otp_table)
                .where(eq(password_reset_otp_table.user_id, user.id)).limit(1);
            const retryAfter = record
                ? Math.ceil((record.last_sent_at.getTime() + PASSWORD_RESET_OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000)
                : 0;
            if (retryAfter > 0) {
                return {
                    status: 429,
                    body: {
                        success: false,
                        message: 'Tunggu sebelum meminta OTP baru.',
                        retry_after_seconds: retryAfter,
                    },
                };
            }

            const code = await createPasswordResetOtp();
            await tx.insert(password_reset_otp_table).values({
                user_id: user.id,
                otp_hash: code.otpHash,
                expires_at: code.expiresAt,
                last_sent_at: code.sentAt,
                attempts: 0,
            }).onConflictDoUpdate({
                target: password_reset_otp_table.user_id,
                set: { otp_hash: code.otpHash, expires_at: code.expiresAt, last_sent_at: code.sentAt, attempts: 0 },
            });
            await sendPasswordResetOtp(user.email, code.otp);

            return generic;
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, 'Lupa password');
    }
};

export const resetPassword = async (req: Request, res: Response) => {
    try {
        const email: string = req.body.email;
        const otp: string = req.body.otp;
        const newPassword: string = req.body.new_password;

        const hashed = await bcrypt.hash(newPassword, 10);

        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            const [user] = await tx.select().from(user_table).where(matchesEmail(email)).limit(1).for('update');
            if (!user) return failure(400, 'Email atau OTP tidak valid');

            const [record] = await tx.select().from(password_reset_otp_table)
                .where(eq(password_reset_otp_table.user_id, user.id)).limit(1);
            if (!record) return failure(400, 'OTP tidak ditemukan. Silakan minta OTP baru.');
            if (record.attempts >= PASSWORD_RESET_OTP_MAX_ATTEMPTS) {
                return failure(429, 'Batas percobaan OTP tercapai. Silakan minta OTP baru.');
            }
            if (record.expires_at.getTime() <= Date.now()) {
                return failure(400, 'OTP sudah kedaluwarsa. Silakan minta OTP baru.');
            }

            const valid = await bcrypt.compare(otp, record.otp_hash);
            if (!valid) {
                const attempts = record.attempts + 1;
                await tx.update(password_reset_otp_table).set({ attempts })
                    .where(eq(password_reset_otp_table.user_id, user.id));
                return failure(attempts >= PASSWORD_RESET_OTP_MAX_ATTEMPTS ? 429 : 400,
                    attempts >= PASSWORD_RESET_OTP_MAX_ATTEMPTS
                        ? 'Batas percobaan OTP tercapai. Silakan minta OTP baru.'
                        : 'OTP tidak valid');
            }

            const now = new Date();
            await tx.update(user_table)
                .set({ password: hashed, updated_at: now })
                .where(eq(user_table.id, user.id));
            await tx.delete(password_reset_otp_table).where(eq(password_reset_otp_table.user_id, user.id));
            // Any stolen session must not survive a password reset.
            await tx.update(refresh_token_table)
                .set({ revoked_at: now })
                .where(and(eq(refresh_token_table.user_id, user.id), isNull(refresh_token_table.revoked_at)));
            await recordAudit(tx, {
                actorId: user.id,
                action: 'auth.password_reset',
                entityType: 'user',
                entityId: user.id,
            });

            return {
                status: 200,
                body: { success: true, message: 'Password berhasil diubah. Silakan login kembali.' },
            };
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, 'Reset password');
    }
};
