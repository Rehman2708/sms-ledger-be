import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { deleteAccount, login, register } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Credential-guessing surface — cap attempts per IP rather than leaving
// login/register open to unlimited brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.delete('/account', requireAuth, deleteAccount);

export default router;
