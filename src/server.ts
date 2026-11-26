import express, { Request, Response } from "express";
import 'dotenv/config';
import mainRouter from './index';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';

// Init App
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// JSON for API payloads. File uploads use a raw body parser on their own route.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Use the main router
app.use('/api/v1', mainRouter);

// Basic API Test
app.get("/health", (req: Request, res: Response)=>{
    res.status(200).json({
        status: "OK",
        message: "AMAN BOS!"
    })
});

app.get("/", (req: Request, res: Response) => {
    res.send("Masuk bro!");
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
