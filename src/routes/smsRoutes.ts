import { Router } from 'express';
import { getSyncCursor, uploadSms } from '../controllers/smsController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/upload', requireAuth, uploadSms);
router.get('/cursor', requireAuth, getSyncCursor);

export default router;
