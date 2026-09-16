import express, { Request, Response } from "express";
import dotenv from 'dotenv';
import mainRouter from './index';

// Config
dotenv.config();

// Init App
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});