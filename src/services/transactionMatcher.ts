import Transaction, { type Transaction as TransactionDoc } from '../models/Transaction';
import type { ParsedSms } from './smsParser';
import type { HydratedDocument, Types } from 'mongoose';

// How far apart two SMS can be and still plausibly describe the same
// real-world payment (e.g. bank debit alert + UPI app confirmation, which
// typically land within seconds to a couple of minutes of each other).
const MATCH_WINDOW_MS = 5 * 60 * 1000;

/**
 * Finds an existing transaction that `parsed` most likely duplicates —
 * same user/type/amount within a tight time window. Only merges when the
 * two SMS aren't both confidently attributed to the *same* bank: two bank
 * alerts naming the same bank for the same amount are more likely genuinely
 * separate transactions than a bank+app pair for one payment, so those are
 * left as distinct rows rather than silently merged.
 */
export async function findMergeCandidate(
  userId: Types.ObjectId | string,
  parsed: ParsedSms,
  receivedAt: Date
): Promise<HydratedDocument<TransactionDoc> | null> {
  const since = new Date(receivedAt.getTime() - MATCH_WINDOW_MS);
  const until = new Date(receivedAt.getTime() + MATCH_WINDOW_MS);

  const candidates = await Transaction.find({
    user: userId,
    type: parsed.type,
    amount: parsed.amount,
    transactionDate: { $gte: since, $lte: until },
  }).sort({ transactionDate: 1 });

  return (
    candidates.find((c) => !c.bank || !parsed.bank || c.bank !== parsed.bank) ?? null
  );
}
