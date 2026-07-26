import { Router } from 'express';
import { getTransactionDetail, listTransactions } from '../controllers/transactionController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, listTransactions);
router.get('/:id', requireAuth, getTransactionDetail);

export default router;
