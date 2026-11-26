import "dotenv/config";
import { Resend } from "resend";
import { REGISTER_OTP_TTL_SECONDS, PASSWORD_RESET_OTP_TTL_SECONDS } from "./otp.service";

export class EmailDeliveryError extends Error {
    constructor() {
        super("Email OTP tidak dapat dikirim");
        this.name = "EmailDeliveryError";
    }
}

async function deliver(to: string, subject: string, text: string, html: string) {
    // Local development fallback: print the email instead of calling Resend.
    // Never enabled unless EMAIL_DRIVER=console is set explicitly.
    if (process.env.EMAIL_DRIVER === 'console') {
        console.log(`[email:console] to=${to} subject=${subject}\n${text}`);
        return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new EmailDeliveryError();
    }

    try {
        const resend = new Resend(apiKey);
        const { data, error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || "Mobile API <onboarding@resend.dev>",
            to: [to],
            subject,
            text,
            html,
        }, { signal: AbortSignal.timeout(15_000) });

        // Resend can return an API error without rejecting the promise.
        if (error || !data?.id) {
            throw new EmailDeliveryError();
        }
    } catch {
        // Never expose the API key or the message containing the OTP.
        throw new EmailDeliveryError();
    }
}

export async function sendRegistrationOtp(email: string, otp: string) {
    const minutes = REGISTER_OTP_TTL_SECONDS / 60;
    await deliver(
        email,
        "Kode OTP verifikasi registrasi",
        `Kode OTP registrasi Anda: ${otp}\n\nKode ini berlaku selama ${minutes} menit dan hanya dapat digunakan sekali. Jangan bagikan kode ini kepada siapa pun.\n\nJika Anda tidak melakukan registrasi, abaikan email ini.`,
        `<p>Kode OTP registrasinya WOY:</p><p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${otp}</p><p>Kode ini berlaku selama ${minutes} menit BURU CEK KOCAK!</p>`,
    );
}

export async function sendPasswordResetOtp(email: string, otp: string) {
    const minutes = PASSWORD_RESET_OTP_TTL_SECONDS / 60;
    await deliver(
        email,
        "Kode OTP reset password",
        `Kode OTP reset password Anda: ${otp}\n\nKode ini berlaku selama ${minutes} menit dan hanya dapat digunakan sekali. Jika Anda tidak meminta reset password, abaikan email ini dan password Anda tidak akan berubah.`,
        `<p>Kode OTP reset password Anda:</p><p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${otp}</p><p>Kode ini berlaku selama ${minutes} menit. Jika Anda tidak meminta reset password, abaikan email ini.</p>`,
    );
}
