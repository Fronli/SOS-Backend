import { Router } from "express";
import {
    forgotPassword,
    login,
    logout,
    refresh,
    register,
    resendOtp,
    resetPassword,
    verifyOtp,
} from "../controllers/auth.controller";
import { authenticateToken } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validate.middleware";
import { byEmail, rateLimit } from "../middlewares/rateLimit.middleware";
import {
    forgotPasswordSchema,
    loginSchema,
    logoutSchema,
    refreshSchema,
    registerSchema,
    resendOtpSchema,
    resetPasswordSchema,
    verifyEmailSchema,
} from "../validators/auth.validator";

const router = Router();

const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    key: byEmail,
    message: 'Terlalu banyak percobaan login. Coba lagi nanti.',
});
const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: byEmail });
const resendLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: byEmail });
const forgotLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: byEmail });
const refreshLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

router.post('/register', registerLimit, validate({ body: registerSchema }), register);
router.post('/verify-email', validate({ body: verifyEmailSchema }), verifyOtp);
router.post('/verify-otp', validate({ body: verifyEmailSchema }), verifyOtp);
router.post('/resend-otp', resendLimit, validate({ body: resendOtpSchema }), resendOtp);
router.post('/login', loginLimit, validate({ body: loginSchema }), login);
router.post('/refresh', refreshLimit, validate({ body: refreshSchema }), refresh);
router.post('/logout', authenticateToken, validate({ body: logoutSchema }), logout);
router.post('/forgot-password', forgotLimit, validate({ body: forgotPasswordSchema }), forgotPassword);
router.post('/reset-password', validate({ body: resetPasswordSchema }), resetPassword);

export default router;
