import { Router } from 'express';
import { listAccountNicknames, upsertAccountNickname } from '../controllers/accountController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, listAccountNicknames);
router.put('/', requireAuth, upsertAccountNickname);

export default router;
