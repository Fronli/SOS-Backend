import { Router } from 'express';
import { authenticateToken, requireVerified } from '../middlewares/authMiddleware';
import {
    createRequest,
    listRequests_,
    getRequest,
    updateRequest,
    deleteRequest,
} from '../controllers/request.controller';

const router = Router();

// GET /api/v1/requests — list all requests (JWT + verified)
router.get('/', authenticateToken, requireVerified, listRequests_);

// POST /api/v1/requests — create request (JWT + verified)
router.post('/', authenticateToken, requireVerified, createRequest);

// GET /api/v1/requests/:id — get request detail (JWT + verified)
router.get('/:id', authenticateToken, requireVerified, getRequest);

// PATCH /api/v1/requests/:id — update own request (JWT + verified)
router.patch('/:id', authenticateToken, requireVerified, updateRequest);

// DELETE /api/v1/requests/:id — soft-delete own request (JWT + verified)
router.delete('/:id', authenticateToken, requireVerified, deleteRequest);

export default router;

