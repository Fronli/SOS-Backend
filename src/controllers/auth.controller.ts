import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/db";
import { registration_otp_table, user_table } from "../db/schema";
import { EmailDeliveryError, sendRegistrationOtp } from "../services/mail.service";
import {
    createRegistrationOtp,
    REGISTER_OTP_MAX_ATTEMPTS,
    REGISTER_OTP_RESEND_SECONDS,
    REGISTER_OTP_TTL_SECONDS,
} from "../services/otp.service";

const publicUserFields = {
    id: user_table.id,
    full_name: user_table.full_name,
    email: user_table.email,
    university: user_table.university,
    major: user_table.major,
    linkedin_url: user_table.linkedin_url,
    website: user_table.website,
    email_verified_at: user_table.email_verified_at,
    created_at: user_table.created_at,
    updated_at: user_table.updated_at,
};

type AuthResult = {
    status: number;
    body: {
        success: boolean;
        message: string;
        data?: unknown;
        retry_after_seconds?: number;
    };
};

function failure(status: number, message: string): AuthResult {
    return { status, body: { success: false, message } };
}

function respond(res: Response, result: AuthResult) {
    if (result.body.retry_after_seconds) {
        res.setHeader("Retry-After", result.body.retry_after_seconds);
    }
    return res.status(result.status).json(result.body);
}

function normalizeEmail(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

// Match older accounts that were saved before email normalization was introduced.
function matchesEmail(email: string) {
    return sql`lower(${user_table.email}) = ${email}`;
}

function handleAuthError(res: Response, error: unknown, operation: string) {
    if (error instanceof EmailDeliveryError) {
        console.log(error);
        return respond(res, failure(503, "Email OTP gagal dikirim. Silakan coba lagi nanti."));
    }

    // SQL/email errors can contain sensitive parameters; log only the operation.
    console.error(`${operation} gagal`);
    return respond(res, failure(500, "Terjadi kesalahan pada server"));
}

export const register = async (req: Request, res: Response) => {
    try {
        const body = req.body || {};
        const { password } = body;
        const email = normalizeEmail(body.email);
        const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";

        if (!fullName || !email || typeof password !== "string" || !password) {
            return respond(res, failure(400, "full_name, email valid, dan password wajib diisi"));
        }
        if (fullName.length > 255 || Buffer.byteLength(password, "utf8") > 72) {
            return respond(res, failure(400, "full_name maksimal 255 karakter dan password maksimal 72 byte"));
        }

        const profile: Record<string, string> = {};

        for (const field of ["university", "major", "linkedin_url", "website"] as const) {
            const value = body[field];
            if (value != null && (typeof value !== "string" || value.length > 255)) {
                return respond(res, failure(400, `${field} harus berupa teks maksimal 255 karakter`));
            }
            profile[field] = value || "";
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            const [existingUser] = await tx.select({ id: user_table.id }).from(user_table)
                .where(matchesEmail(email)).limit(1);
            if (existingUser) {
                return failure(409, "Email sudah terdaftar. Gunakan kirim ulang OTP jika belum terverifikasi.");
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

            if (!newUser) return failure(409, "Email sudah terdaftar");

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
                    message: "Registrasi berhasil. Periksa email Anda untuk verifikasi OTP.",
                    data: { ...newUser, requires_verification: true, otp_expires_in: REGISTER_OTP_TTL_SECONDS },
                },
            };
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, "Registrasi");
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const otp = req.body?.otp;
        if (!email || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
            return respond(res, failure(400, "Email valid dan OTP berupa 6 digit angka wajib diisi"));
        }

        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            // Verification and resend lock the same account to serialize OTP changes.
            const [user] = await tx.select().from(user_table).where(matchesEmail(email)).limit(1).for("update");
            if (!user) return failure(400, "Email atau OTP tidak valid");
            if (user.email_verified_at) return failure(409, "Email sudah terverifikasi. Silakan login.");

            const [record] = await tx.select().from(registration_otp_table)
                .where(eq(registration_otp_table.user_id, user.id)).limit(1);
            if (!record) return failure(400, "OTP tidak ditemukan. Silakan kirim ulang OTP.");
            if (record.attempts >= REGISTER_OTP_MAX_ATTEMPTS) {
                return failure(429, "Batas percobaan OTP tercapai. Silakan kirim ulang OTP.");
            }
            if (record.expires_at.getTime() <= Date.now()) {
                return failure(400, "OTP sudah kedaluwarsa. Silakan kirim ulang OTP.");
            }

            const valid = await bcrypt.compare(otp, record.otp_hash);
            // Recheck after hashing so an OTP cannot be accepted after its deadline.
            if (record.expires_at.getTime() <= Date.now()) {
                return failure(400, "OTP sudah kedaluwarsa. Silakan kirim ulang OTP.");
            }
            if (!valid) {
                const attempts = record.attempts + 1;
                await tx.update(registration_otp_table).set({ attempts })
                    .where(eq(registration_otp_table.user_id, user.id));
                // Return instead of throwing so failed attempts are committed.
                return failure(attempts >= REGISTER_OTP_MAX_ATTEMPTS ? 429 : 400,
                    attempts >= REGISTER_OTP_MAX_ATTEMPTS
                        ? "Batas percobaan OTP tercapai. Silakan kirim ulang OTP."
                        : "OTP tidak valid");
            }

            const now = new Date();
            const [verifiedUser] = await tx.update(user_table)
                .set({ email_verified_at: now, updated_at: now })
                .where(eq(user_table.id, user.id)).returning(publicUserFields);
            await tx.delete(registration_otp_table).where(eq(registration_otp_table.user_id, user.id));

            return { status: 200, body: { success: true, message: "Email berhasil diverifikasi. Silakan login.", data: verifiedUser } };
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, "Verifikasi OTP");
    }
};

export const resendOtp = async (req: Request, res: Response) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!email) return respond(res, failure(400, "Email valid wajib diisi"));

        const result = await db.transaction(async (tx): Promise<AuthResult> => {
            const [user] = await tx.select().from(user_table).where(matchesEmail(email)).limit(1).for("update");
            if (!user) return failure(400, "Email belum terdaftar");
            if (user.email_verified_at) return failure(409, "Email sudah terverifikasi. Silakan login.");

            const [record] = await tx.select().from(registration_otp_table)
                .where(eq(registration_otp_table.user_id, user.id)).limit(1);
            const retryAfter = record
                ? Math.ceil((record.last_sent_at.getTime() + REGISTER_OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000)
                : 0;
            if (retryAfter > 0) {
                return {
                    status: 429,
                    body: { success: false, message: "Tunggu sebelum mengirim ulang OTP.", retry_after_seconds: retryAfter },
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
                body: { success: true, message: "OTP baru telah dikirim ke email Anda.", data: { otp_expires_in: REGISTER_OTP_TTL_SECONDS } },
            };
        });

        return respond(res, result);
    } catch (error) {
        return handleAuthError(res, error, "Kirim ulang OTP");
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;

        if (!email || typeof password !== "string" || !password) {
            return respond(res, failure(400, "Email valid dan password wajib diisi"));
        }

        const [user] = await db.select().from(user_table).where(matchesEmail(email)).limit(1);
        if (!user || !await bcrypt.compare(password, user.password)) {
            return respond(res, failure(401, "Email atau password salah"));
        }
        if (!user.email_verified_at) {
            return respond(res, failure(403, "Email belum terverifikasi. Silakan verifikasi OTP terlebih dahulu."));
        }

        const jwtSecret = process.env.JWT_SECRET || "your_jwt_secret_key";
        const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: "1d" });
        const { password: _, ...userData } = user;

        return res.status(200).json({
            success: true,
            message: "Login berhasil",
            data: { user: userData, token },
        });
    } catch (error) {
        return handleAuthError(res, error, "Login");
    }
};
