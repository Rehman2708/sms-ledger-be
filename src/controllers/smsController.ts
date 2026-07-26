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
  let failed = 0;

  const hashes = messages.map((msg) =>
    crypto
      .createHash('sha256')
      .update(`${req.userId}:${msg.sender}:${msg.body}:${msg.receivedAt}`)
      .digest('hex')
  );

  // One query for the whole batch instead of one per message — the
  // dominant cost on a large first-ever sync, since it runs for every
  // message regardless of whether it later turns out to be a transaction.
  const existingHashes = new Set(
    (await RawSms.find({ hash: { $in: hashes } }, { hash: 1 }).lean()).map((d) => d.hash)
  );

  // The raw-storage step has no cross-message dependency, so it's the one
  // part of this loop safe to do as a single bulk write instead of one
  // round-trip per message — the dominant cost for a large batch. The
  // parse/merge step below stays sequential: it must see Transactions
  // created earlier in this same batch to merge correctly (e.g. a bank
  // alert + UPI app confirmation landing in the same sync).
  const newEntries: Array<{ msg: IncomingSms; hash: string }> = [];
  for (let idx = 0; idx < messages.length; idx += 1) {
    const hash = hashes[idx];
    if (existingHashes.has(hash)) {
      duplicates += 1;
      continue;
    }
    // Two messages in the same batch can share a hash (e.g. an identical
    // promo/OTP SMS repeated) — the upfront query above can't see that.
    existingHashes.add(hash);
    newEntries.push({ msg: messages[idx], hash });
  }

  let createdDocs: Array<InstanceType<typeof RawSms>> = [];
  if (newEntries.length > 0) {
    try {
      createdDocs = await RawSms.insertMany(
        newEntries.map(({ msg, hash }) => ({
          user: req.userId,
          sender: msg.sender,
          body: msg.body,
          receivedAt: new Date(msg.receivedAt),
          hash,
        })),
        { ordered: false }
      );
    } catch (err) {
      // ordered:false keeps inserting past individual failures (e.g. a rare
      // duplicate-hash race) — the driver reports those via insertedDocs.
      const bulkErr = err as { insertedDocs?: Array<InstanceType<typeof RawSms>> };
      createdDocs = bulkErr.insertedDocs ?? [];
      failed += newEntries.length - createdDocs.length;
      console.error('Some SMS in upload batch failed to store', {
        attempted: newEntries.length,
        stored: createdDocs.length,
        error: err instanceof Error ? err.message : err,
      });
    }
  }
  stored += createdDocs.length;

  for (const rawSms of createdDocs) {
    // Isolate each message: a transient DB hiccup or a single malformed SMS
    // must not crash the rest of a large batch (a first-ever sync can carry
    // thousands of messages in one request) — log it, count it, keep going.
    try {
      const parsed = parseSms(rawSms.body, rawSms.sender);
      if (!parsed) continue;

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
    } catch (err) {
      failed += 1;
      console.error('Failed to parse/merge one SMS in upload batch', {
        sender: rawSms.sender,
        receivedAt: rawSms.receivedAt,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  res.status(201).json({ stored, duplicates, parsed: parsedCount, merged: mergedCount, failed });
}
