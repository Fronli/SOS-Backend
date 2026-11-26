import { Router } from 'express';
import { getPublicUser, getUserReviews, listHelpers } from '../controllers/helper.controller';
import { createDirectRequest } from '../controllers/directRequest.controller';
import { authenticateToken, optionalAuth, requireVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import { idParamSchema } from '../validators/common.validator';
import { directRequestSchema } from '../validators/safety.validator';

const router = Router();

// Public profiles: no email, NIM or suspension data is exposed.
router.get('/users/:id', optionalAuth, validate({ params: idParamSchema }), getPublicUser);
router.get('/users/:id/reviews', optionalAuth, validate({ params: idParamSchema }), getUserReviews);
router.get('/helpers', optionalAuth, listHelpers);

router.post(
    '/helpers/:id/direct-requests',
    authenticateToken,
    requireVerified,
    validate({ params: idParamSchema, body: directRequestSchema }),
    createDirectRequest,
);

export default router;
