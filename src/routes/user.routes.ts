import { Router } from 'express';
import { authenticateToken, requireVerified } from '../middlewares/authMiddleware';
import { getProfile, updateProfile } from '../controllers/user.controller';
import { listMyRequests } from '../controllers/request.controller';

const router = Router();

// GET /api/v1/users/me — profile (JWT required, verification NOT required)
router.get('/me', authenticateToken, getProfile);

// PATCH /api/v1/users/me — update profile (JWT + verified)
router.patch('/me', authenticateToken, requireVerified, updateProfile);

// GET /api/v1/users/me/requests — own requests (JWT + verified)
router.get('/me/requests', authenticateToken, requireVerified, listMyRequests);

export default router;
