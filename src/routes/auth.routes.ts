import { Router } from "express";
import { login, register, resendOtp, verifyOtp } from "../controllers/auth.controller";

const router = Router();

router.post('/login', login);
router.post('/register', register);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);

export default router
