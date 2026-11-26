import { Router, raw } from 'express';
import {
    deleteUpload, presignUpload, serveFile, uploadFile,
} from '../controllers/upload.controller';
import { authenticateToken, optionalAuth, requireVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import { presignSchema } from '../validators/upload.validator';

const router = Router();

// Raw body parser must run before the JSON parser sees binary data; mounting it
// on the route keeps the global JSON middleware untouched.
router.put('/uploads/:key', authenticateToken, requireVerified, raw({
    type: () => true,
    limit: '10mb',
}), uploadFile);
router.post('/uploads/presign', authenticateToken, requireVerified, validate({ body: presignSchema }), presignUpload);
router.delete('/uploads/:key', authenticateToken, requireVerified, deleteUpload);
router.get('/files/:key', optionalAuth, serveFile);

export default router;
