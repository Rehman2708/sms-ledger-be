import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import Transaction from '../models/Transaction';

export async function listTransactions(req: AuthedRequest, res: Response): Promise<void> {
  const { kind, category, from, to } = req.query;

  const filter: Record<string, unknown> = { user: req.userId };
  if (kind) filter.kind = kind;
  if (category) filter.category = category;
  if (from || to) {
    filter.transactionDate = {
      ...(from ? { $gte: new Date(String(from)) } : {}),
      ...(to ? { $lte: new Date(String(to)) } : {}),
    };
  }

  const transactions = await Transaction.find(filter).sort({ transactionDate: -1 });
  res.json({ transactions });
}
