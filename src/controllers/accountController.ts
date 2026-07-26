import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import AccountNickname from '../models/AccountNickname';

export async function listAccountNicknames(req: AuthedRequest, res: Response): Promise<void> {
  const accounts = await AccountNickname.find({ user: req.userId }).lean();
  res.json({ accounts });
}

export async function upsertAccountNickname(req: AuthedRequest, res: Response): Promise<void> {
  const { bank: rawBank, accountLast4, nickname } = req.body ?? {};

  if (typeof rawBank !== 'string' || !rawBank.trim()) {
    res.status(400).json({ message: 'bank is required' });
    return;
  }
  if (typeof nickname !== 'string' || !nickname.trim()) {
    res.status(400).json({ message: 'nickname is required' });
    return;
  }
  // Untrimmed bank strings ("HDFC" vs "HDFC ") would otherwise pass the
  // compound unique index as distinct docs for what's really the same bank.
  const bank = rawBank.trim();

  const filter = {
    user: req.userId,
    bank,
    accountLast4: typeof accountLast4 === 'string' ? accountLast4 : '',
  };

  // Filter's accountLast4 is a runtime-validated string, not the schema's
  // literal-union type, which is enough to make TS pick the wrong
  // findOneAndUpdate overload — the filter shape itself is correct.
  const account = await AccountNickname.findOneAndUpdate(
    filter as Record<string, unknown>,
    { $set: { nickname: nickname.trim() } },
    { upsert: true, new: true }
  );

  res.json({ account });
}
