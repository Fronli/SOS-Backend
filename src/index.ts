import { Router } from 'express';
import authRouter from './routes/auth.routes';
import userRouter from './routes/user.routes';
import tagRouter from './routes/tag.routes';
import requestRouter from './routes/request.routes';
import meRouter from './routes/me.routes';
import replyRouter from './routes/reply.routes';
import conversationRouter from './routes/conversation.routes';
import assignmentRouter from './routes/assignment.routes';
import helperRouter from './routes/helper.routes';
import metaRouter from './routes/meta.routes';
import uploadRouter from './routes/upload.routes';
import safetyRouter from './routes/safety.routes';
import adminRouter from './routes/admin.routes';
import webhookRouter from './routes/webhook.routes';

const mainRouter = Router();

mainRouter.use('/auth', authRouter);
mainRouter.use('/users', userRouter);
mainRouter.use('/tags', tagRouter);
mainRouter.use('/meta', metaRouter);
mainRouter.use('/requests', requestRouter);
mainRouter.use('/me', meRouter);
mainRouter.use('/replies', replyRouter);
mainRouter.use('/conversations', conversationRouter);
mainRouter.use('/assignments', assignmentRouter);
mainRouter.use('/webhooks/payments', webhookRouter);
mainRouter.use('/admin', adminRouter);

// Public helper/profile discovery and safety endpoints share the root.
// uploadRouter also defines /uploads/* and /files/:key.
mainRouter.use('/', helperRouter);
mainRouter.use('/', safetyRouter);
mainRouter.use('/', uploadRouter);

export default mainRouter;
