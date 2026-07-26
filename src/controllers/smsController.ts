import type { Response } from 'express';
import crypto from 'node:crypto';
import type { AuthedRequest } from '../middleware/auth';
import RawSms from '../models/RawSms';
import Transaction from '../models/Transaction';
import { classifyMerchant } from '../services/merchantClassifier';
import { parseSms } from '../services/smsParser';
import { findMergeCandidate } from '../services/transactionMatcher';

interface IncomingSms {
  sender: string;
  body: string;
  receivedAt: string;
}

export async function uploadSms(req: AuthedRequest, res: Response): Promise<void> {
  const messages: IncomingSms[] = req.body?.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ message: 'messages array is required' });
    return;
  }

  let stored = 0;
  let duplicates = 0;
  let parsedCount = 0;
  let mergedCount = 0;

  for (const msg of messages) {
    const hash = crypto
      .createHash('sha256')
      .update(`${req.userId}:${msg.sender}:${msg.body}:${msg.receivedAt}`)
      .digest('hex');

    const existing = await RawSms.findOne({ hash });
    if (existing) {
      duplicates += 1;
      continue;
    }

    const rawSms = await RawSms.create({
      user: req.userId,
      sender: msg.sender,
      body: msg.body,
      receivedAt: new Date(msg.receivedAt),
      hash,
    });
    stored += 1;

    const parsed = parseSms(msg.body, msg.sender);
    if (parsed) {
      const mergeCandidate = await findMergeCandidate(req.userId!, parsed, rawSms.receivedAt);

      if (mergeCandidate) {
        // Same payment reported by a second SMS (e.g. bank alert + UPI app
        // confirmation) — link it instead of double-counting the spend.
        mergeCandidate.relatedRawSms = [...mergeCandidate.relatedRawSms, rawSms._id];
        mergeCandidate.sourceCount = (mergeCandidate.sourceCount ?? 1) + 1;
        mergeCandidate.bank = mergeCandidate.bank ?? parsed.bank;
        mergeCandidate.merchant = mergeCandidate.merchant ?? parsed.merchant;
        mergeCandidate.accountLast4 = mergeCandidate.accountLast4 ?? parsed.accountLast4;
        await mergeCandidate.save();

        rawSms.duplicateOfTransaction = mergeCandidate._id;
        mergedCount += 1;
      } else {
        const { category, kind } = classifyMerchant(parsed.merchant);
        await Transaction.create({
          user: req.userId,
          rawSms: rawSms.id,
          amount: parsed.amount,
          type: parsed.type,
          category,
          kind,
          merchant: parsed.merchant,
          bank: parsed.bank,
          accountLast4: parsed.accountLast4,
          transactionDate: rawSms.receivedAt,
        });
      }

      rawSms.parsed = true;
      await rawSms.save();
      parsedCount += 1;
    }
  }

  res.status(201).json({ stored, duplicates, parsed: parsedCount, merged: mergedCount });
}
