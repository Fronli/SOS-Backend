import { Router } from 'express';
import { deleteReply } from '../controllers/reply.controller';
import { authenticateToken, requireVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import { idParamSchema } from '../validators/common.validator';

const router = Router();

router.delete('/:id', authenticateToken, requireVerified, validate({ params: idParamSchema }), deleteReply);

export default router;
