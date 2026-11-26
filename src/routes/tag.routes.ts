import { Router } from 'express';
import { getTags } from '../controllers/tag.controller';

const router = Router();

// Public catalog, same data as GET /meta/subjects.
router.get('/', getTags);

export default router;
