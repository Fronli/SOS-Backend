import "dotenv/config";
import { Resend } from "resend";
import { REGISTER_OTP_TTL_SECONDS } from "./otp.service";

export class EmailDeliveryError extends Error {
    constructor() {
        super("Email OTP tidak dapat dikirim");
        this.name = "EmailDeliveryError";
    }
}

export async function sendRegistrationOtp(email: string, otp: string) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new EmailDeliveryError();
    }

    const minutes = REGISTER_OTP_TTL_SECONDS / 60;
    try {
        const resend = new Resend(apiKey);
        const { data, error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || "Mobile API <onboarding@resend.dev>",
            to: [email],
            subject: "Kode OTP verifikasi registrasi",
            text: `Kode OTP registrasi Anda: ${otp}\n\nKode ini berlaku selama ${minutes} menit dan hanya dapat digunakan sekali. Jangan bagikan kode ini kepada siapa pun.\n\nJika Anda tidak melakukan registrasi, abaikan email ini.`,
            html: `<p>Kode OTP registrasinya WOY:</p><p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${otp}</p><p>Kode ini berlaku selama ${minutes} menit BURU CEK KOCAK!</p>`,
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
