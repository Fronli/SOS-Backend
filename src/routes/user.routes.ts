import { Router } from 'express';
import { authenticateToken, loadCurrentUser, requireVerified } from '../middlewares/authMiddleware';
import { getProfile, updateProfile } from '../controllers/user.controller';
import { listMyRequests } from '../controllers/request.controller';
import { validate } from '../middlewares/validate.middleware';
import { myRequestsQuerySchema } from '../validators/request.validator';

const router = Router();

// Legacy paths kept for the existing mobile release.
// New clients should use /me, /me/requests and /users/:id.
router.get('/me', authenticateToken, loadCurrentUser, getProfile);
router.patch('/me', authenticateToken, loadCurrentUser, requireVerified, updateProfile);
router.get('/me/requests', authenticateToken, loadCurrentUser, requireVerified, validate({ query: myRequestsQuerySchema }), listMyRequests);

export default router;
