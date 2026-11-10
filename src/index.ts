import { Router } from "express";
import authRouter from "./routes/auth.routes";
import userRouter from "./routes/user.routes";
import tagRouter from "./routes/tag.routes";
import requestRouter from "./routes/request.routes";

const mainRouter = Router();

mainRouter.use('/auth', authRouter);
mainRouter.use('/users', userRouter);
mainRouter.use('/tags', tagRouter);
mainRouter.use('/requests', requestRouter);

export default mainRouter;
