import { Router } from 'express';
import {
    cancelRequest, createRequest, deleteRequest, getRequest, listRequests_, updateRequest,
} from '../controllers/request.controller';
import {
    createReply, deleteReply, listReplies,
} from '../controllers/reply.controller';
import { createAssignment } from '../controllers/assignment.controller';
import { authenticateToken, requireVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import {
    cancelRequestSchema, createRequestSchema, listRequestsQuerySchema,
    updateRequestSchema,
} from '../validators/request.validator';
import { createReplySchema } from '../validators/reply.validator';
import { createAssignmentSchema } from '../validators/assignment.validator';
import { idParamSchema } from '../validators/common.validator';

const router = Router();

router.use(authenticateToken, requireVerified);

router.get('/', validate({ query: listRequestsQuerySchema }), listRequests_);
router.post('/', validate({ body: createRequestSchema }), createRequest);

router.get('/:id', validate({ params: idParamSchema }), getRequest);
router.patch('/:id', validate({ params: idParamSchema, body: updateRequestSchema }), updateRequest);
router.delete('/:id', validate({ params: idParamSchema }), deleteRequest);
router.post('/:id/cancel', validate({ params: idParamSchema, body: cancelRequestSchema }), cancelRequest);

router.get('/:id/replies', validate({ params: idParamSchema }), listReplies);
router.post('/:id/replies', validate({ params: idParamSchema, body: createReplySchema }), createReply);

router.post('/:id/assignments', validate({ params: idParamSchema, body: createAssignmentSchema }), createAssignment);

export default router;
