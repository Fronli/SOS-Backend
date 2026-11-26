import { Router } from 'express';
import { listSubjects } from '../controllers/meta.controller';

const router = Router();

router.get('/subjects', listSubjects);

export default router;
