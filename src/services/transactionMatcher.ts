import type { ParsedSms } from './smsParser';
import type { Types } from 'mongoose';

// How far apart two SMS can be and still plausibly describe the same
// real-world payment (e.g. bank debit alert + UPI app confirmation, which
// typically land within seconds to a couple of minutes of each other).
export const MATCH_WINDOW_MS = 5 * 60 * 1000;

export interface MergeCandidate {
  _id: Types.ObjectId;
  type: 'debit' | 'credit';
  amount: number;
  transactionDate: Date;
  bank?: string;
}

/**
 * Finds the candidate in `pool` that `parsed` most likely duplicates — same
 * type/amount within a tight time window of `receivedAt`. Only merges when
 * the two SMS aren't both confidently attributed to the *same* bank: two
 * bank alerts naming the same bank for the same amount are more likely
 * genuinely separate transactions than a bank+app pair for one payment, so
 * those are left as distinct rows rather than silently merged. Ties go to
 * the earliest-dated match, matching the single-query behavior this
 * replaces (a sorted-ascending find()).
 */
export function pickMergeCandidate<T extends MergeCandidate>(
  pool: T[],
  parsed: ParsedSms,
  receivedAt: Date
): T | undefined {
  const since = receivedAt.getTime() - MATCH_WINDOW_MS;
  const until = receivedAt.getTime() + MATCH_WINDOW_MS;

  return pool
    .filter(
      (c) =>
        c.type === parsed.type &&
        c.amount === parsed.amount &&
        c.transactionDate.getTime() >= since &&
        c.transactionDate.getTime() <= until &&
        (!c.bank || !parsed.bank || c.bank !== parsed.bank)
    )
    .sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime())[0];
}
