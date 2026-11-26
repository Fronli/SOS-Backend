import { randomInt } from "node:crypto";
import bcrypt from "bcrypt";

export const REGISTER_OTP_TTL_SECONDS = 10 * 60;
export const REGISTER_OTP_MAX_ATTEMPTS = 5;
export const REGISTER_OTP_RESEND_SECONDS = 60;

export const PASSWORD_RESET_OTP_TTL_SECONDS = 10 * 60;
export const PASSWORD_RESET_OTP_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_OTP_RESEND_SECONDS = 60;

export const OTP_DIGITS = 6;

export async function createOtp(digits = OTP_DIGITS) {
    const max = 10 ** digits;
    const otp = randomInt(0, max).toString().padStart(digits, "0");
    const otpHash = await bcrypt.hash(otp, 10);
    const sentAt = new Date();

    return { otp, otpHash, sentAt };
}

export async function createRegistrationOtp() {
    const code = await createOtp();
    return {
        ...code,
        expiresAt: new Date(code.sentAt.getTime() + REGISTER_OTP_TTL_SECONDS * 1000),
    };
}

export async function createPasswordResetOtp() {
    const code = await createOtp();
    return {
        ...code,
        expiresAt: new Date(code.sentAt.getTime() + PASSWORD_RESET_OTP_TTL_SECONDS * 1000),
    };
}
