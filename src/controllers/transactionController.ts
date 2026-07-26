import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import Transaction from '../models/Transaction';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface Cursor {
  date: Date;
  id: string;
}

// Opaque cursor is just "<isoDate>_<id>" — the (transactionDate, _id) pair
// of the last item on the previous page, matching the sort below.
function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== 'string' || !raw) return null;
  const separatorIndex = raw.lastIndexOf('_');
  if (separatorIndex === -1) return null;
  const date = new Date(raw.slice(0, separatorIndex));
  const id = raw.slice(separatorIndex + 1);
  if (!id || Number.isNaN(date.getTime())) return null;
  return { date, id };
}

export async function listTransactions(req: AuthedRequest, res: Response): Promise<void> {
  const { kind, category, from, to, cursor, limit } = req.query;

  const filter: Record<string, unknown> = { user: req.userId };
  // typeof-guarded even though express 5's default 'simple' query parser
  // can't produce nested objects from bracket notation — cheap
  // defense-in-depth against a future parser config change turning these
  // into Mongo operator injection (e.g. ?kind[$ne]=x).
  if (typeof kind === 'string' && kind) filter.kind = kind;
  if (typeof category === 'string' && category) filter.category = category;
  if (from || to) {
    filter.transactionDate = {
      ...(typeof from === 'string' && from ? { $gte: new Date(from) } : {}),
      ...(typeof to === 'string' && to ? { $lte: new Date(to) } : {}),
    };
  }

  const parsedCursor = decodeCursor(cursor);
  if (parsedCursor) {
    filter.$or = [
      { transactionDate: { $lt: parsedCursor.date } },
      { transactionDate: parsedCursor.date, _id: { $lt: parsedCursor.id } },
    ];
  }

  // No `limit` param → preserve the original unpaginated behavior for
  // callers that need the complete set (dashboard/profile totals, account
  // breakdowns). Pagination is opt-in via `limit`. A non-positive or
  // non-numeric value falls back to the default instead of reaching
  // Mongoose's .limit() with 0/negative, which throws.
  const requestedLimit = Number(limit);
  const pageSize = limit
    ? Math.min(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_LIMIT, MAX_LIMIT)
    : undefined;

  let query = Transaction.find(filter).sort({ transactionDate: -1, _id: -1 });
  if (pageSize) query = query.limit(pageSize + 1);

  const results = await query;

  let transactions = results;
  let nextCursor: string | null = null;
  if (pageSize && results.length > pageSize) {
    transactions = results.slice(0, pageSize);
    const last = transactions[transactions.length - 1];
    nextCursor = `${last.transactionDate.toISOString()}_${last._id}`;
  }

  res.json({ transactions, nextCursor });
}

// Detail view wants the source SMS text too (verify parsing, see reference
// numbers the structured fields don't capture) — kept out of listTransactions
// since populating every row's SMS body would bloat the list payload.
export async function getTransactionDetail(req: AuthedRequest, res: Response): Promise<void> {
  const transaction = await Transaction.findOne({ _id: req.params.id, user: req.userId }).populate(
    ['rawSms', 'relatedRawSms'],
    'sender body receivedAt'
  );

  if (!transaction) {
    res.status(404).json({ message: 'Transaction not found' });
    return;
  }

  res.json({ transaction });
}
