import { randomInt } from "node:crypto";
import bcrypt from "bcrypt";

export const REGISTER_OTP_TTL_SECONDS = 10 * 60;
export const REGISTER_OTP_MAX_ATTEMPTS = 5;
export const REGISTER_OTP_RESEND_SECONDS = 60;

export async function createRegistrationOtp() {
    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const otpHash = await bcrypt.hash(otp, 10);
    const sentAt = new Date();

    return {
        otp,
        otpHash,
        sentAt,
        expiresAt: new Date(sentAt.getTime() + REGISTER_OTP_TTL_SECONDS * 1000),
    };
}
