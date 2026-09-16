import { Response, Request, NextFunction } from "express";

export const login = async (req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: "LOGIN COY!"
    })
}

export const register = async (req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: "REGISTER COY!"
    })
}