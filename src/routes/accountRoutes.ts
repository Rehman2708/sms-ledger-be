import { Router } from 'express';
import {
  listAccountMerges,
  listAccountNicknames,
  mergeAccounts,
  unmergeAccount,
  upsertAccountNickname,
} from '../controllers/accountController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, listAccountNicknames);
router.put('/', requireAuth, upsertAccountNickname);
router.get('/merges', requireAuth, listAccountMerges);
router.post('/merges', requireAuth, mergeAccounts);
router.delete('/merges', requireAuth, unmergeAccount);

export default router;
