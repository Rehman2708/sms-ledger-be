import { Router } from 'express';
import accountRoutes from './accountRoutes';
import authRoutes from './authRoutes';
import smsRoutes from './smsRoutes';
import transactionRoutes from './transactionRoutes';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok' }));
router.use('/auth', authRoutes);
router.use('/sms', smsRoutes);
router.use('/transactions', transactionRoutes);
router.use('/accounts', accountRoutes);

export default router;
