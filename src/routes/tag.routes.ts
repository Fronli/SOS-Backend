import { Router } from 'express';
import { authenticateToken, requireVerified } from '../middlewares/authMiddleware';
import { getTags } from '../controllers/tag.controller';

const router = Router();

// GET /api/v1/tags — tag catalog (JWT + verified)
router.get('/', authenticateToken, requireVerified, getTags);

export default router;

