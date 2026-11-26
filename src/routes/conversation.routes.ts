import { Router } from 'express';
import {
    createConversation, declineConversation, getConversation, listConversations,
    listMessages, markConversationRead, sendMessage,
} from '../controllers/conversation.controller';
import { authenticateToken, requireVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import {
    conversationQuerySchema, createConversationSchema, markReadSchema,
    messageQuerySchema, sendMessageSchema,
} from '../validators/chat.validator';
import { idParamSchema } from '../validators/common.validator';

const router = Router();

router.use(authenticateToken, requireVerified);

router.get('/', validate({ query: conversationQuerySchema }), listConversations);
router.post('/', validate({ body: createConversationSchema }), createConversation);

router.get('/:id', validate({ params: idParamSchema }), getConversation);
router.get('/:id/messages', validate({ params: idParamSchema, query: messageQuerySchema }), listMessages);
router.post('/:id/messages', validate({ params: idParamSchema, body: sendMessageSchema }), sendMessage);
router.post('/:id/read', validate({ params: idParamSchema, body: markReadSchema }), markConversationRead);
router.post('/:id/decline', validate({ params: idParamSchema }), declineConversation);

export default router;
