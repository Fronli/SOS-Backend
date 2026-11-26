import { Router } from 'express';
import {
    approveAgreementHandler, confirmCancellationHandler, confirmCompletionHandler,
    createDispute, createReview, fundAssignmentHandler, getAgreement, getAssignment,
    rejectCancellationHandler, rejectCompletionHandler, requestCancellation,
    requestCompletion,
} from '../controllers/assignment.controller';
import { authenticateToken, requireVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import {
    assignmentActionSchema, disputeSchema, reviewSchema,
} from '../validators/assignment.validator';
import { idParamSchema } from '../validators/common.validator';

const router = Router();

router.use(authenticateToken, requireVerified);

router.get('/:id', validate({ params: idParamSchema }), getAssignment);
router.get('/:id/agreement', validate({ params: idParamSchema }), getAgreement);
router.post('/:id/agreement/approve', validate({ params: idParamSchema }), approveAgreementHandler);
router.post('/:id/fund', validate({ params: idParamSchema }), fundAssignmentHandler);

router.post('/:id/completion', validate({ params: idParamSchema, body: assignmentActionSchema }), requestCompletion);
router.post('/:id/completion/confirm', validate({ params: idParamSchema }), confirmCompletionHandler);
router.post('/:id/completion/reject', validate({ params: idParamSchema, body: assignmentActionSchema }), rejectCompletionHandler);

router.post('/:id/cancellation', validate({ params: idParamSchema, body: assignmentActionSchema }), requestCancellation);
router.post('/:id/cancellation/confirm', validate({ params: idParamSchema }), confirmCancellationHandler);
router.post('/:id/cancellation/reject', validate({ params: idParamSchema }), rejectCancellationHandler);

router.post('/:id/review', validate({ params: idParamSchema, body: reviewSchema }), createReview);
router.post('/:id/disputes', validate({ params: idParamSchema, body: disputeSchema }), createDispute);

export default router;
