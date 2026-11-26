import { Router } from 'express';
import { createReport, blockUser, unblockUser, listBlocks } from '../controllers/safety.controller';
import { authenticateToken, requireVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import { blockSchema, createReportSchema } from '../validators/safety.validator';
import { userIdParamSchema } from '../validators/common.validator';

const router = Router();

// Auth is attached per route: a router-level guard here would also intercept
// unrelated public paths because this router is mounted at the root.
router.post('/reports', authenticateToken, requireVerified, validate({ body: createReportSchema }), createReport);
router.get('/blocks', authenticateToken, requireVerified, listBlocks);
router.post('/blocks', authenticateToken, requireVerified, validate({ body: blockSchema }), blockUser);
router.delete('/blocks/:userId', authenticateToken, requireVerified, validate({ params: userIdParamSchema }), unblockUser);

export default router;
