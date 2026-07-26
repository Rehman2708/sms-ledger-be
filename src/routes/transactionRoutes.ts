import { Router } from 'express';
import { listTransactions } from '../controllers/transactionController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, listTransactions);

export default router;
