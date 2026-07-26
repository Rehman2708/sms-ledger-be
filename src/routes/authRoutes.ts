import { Router } from 'express';
import { deleteAccount, login, register } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.delete('/account', requireAuth, deleteAccount);

export default router;
