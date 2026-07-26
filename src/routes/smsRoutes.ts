import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getSyncCursor, uploadSms } from '../controllers/smsController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Each upload can trigger a batch of DB writes + regex parsing — cap
// request rate per IP so one misbehaving client can't hammer this.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/upload', requireAuth, uploadLimiter, uploadSms);
router.get('/cursor', requireAuth, getSyncCursor);

export default router;
