import { Router } from 'express';
import { uploadSms } from '../controllers/smsController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/upload', requireAuth, uploadSms);

export default router;
