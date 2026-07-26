import type { Response } from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import type { AuthedRequest } from '../middleware/auth';
import RawSms from '../models/RawSms';
import Transaction from '../models/Transaction';
import { classifyMerchant } from '../services/merchantClassifier';
import { parseSms, type ParsedSms } from '../services/smsParser';
import { pickMergeCandidate, MATCH_WINDOW_MS, type MergeCandidate } from '../services/transactionMatcher';

interface IncomingSms {
  sender: string;
  body: string;
  receivedAt: string;
}

// The in-memory merge-candidate pool for one upload batch: existing
// Transactions fetched once up front, plus any new one created earlier in
// this same batch (appended as we go) so later messages can still merge
// against it without a DB round-trip.
interface PoolEntry extends MergeCandidate {
  merchant?: string;
  accountLast4?: string;
  accountType?: string;
  relatedRawSms: mongoose.Types.ObjectId[];
  sourceCount: number;
}

// Lets the client recover its resume point whenever local state is lost
// (reinstall, logout/login, new device, cleared storage) instead of falling
// back to re-reading and re-uploading the entire on-device SMS backlog —
// the server already knows the true high-water mark for this user.
export async function getSyncCursor(req: AuthedRequest, res: Response): Promise<void> {
  const latest = await RawSms.findOne({ user: req.userId }).sort({ receivedAt: -1 }).select('receivedAt').lean();
  res.json({ lastSyncedAt: latest ? latest.receivedAt.getTime() : null });
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

  // A malformed item (missing sender/body, or a receivedAt that doesn't
  // parse to a real date) can't just be hashed-and-stored like the rest: an
  // invalid receivedAt becomes an Invalid Date whose getTime() is NaN, and
  // one NaN in the batch's since/until window computation below (a Math.min
  // /max over every parsed message's timestamp) poisons the *entire* batch's
  // merge-candidate prefetch — not just the one bad message. Filter these
  // out up front instead of letting them reach that shared computation.
  const validMessages: Array<{ msg: IncomingSms; hash: string }> = [];
  for (const msg of messages) {
    const sender = typeof msg?.sender === 'string' ? msg.sender.trim() : '';
    const body = typeof msg?.body === 'string' ? msg.body.trim() : '';
    const receivedAtMs = new Date(msg?.receivedAt).getTime();
    if (!sender || !body || !Number.isFinite(receivedAtMs)) {
      failed += 1;
      continue;
    }
    const hash = crypto
      .createHash('sha256')
      .update(`${req.userId}:${msg.sender}:${msg.body}:${msg.receivedAt}`)
      .digest('hex');
    validMessages.push({ msg, hash });
  }

  // One query for the whole batch instead of one per message — the
  // dominant cost on a large first-ever sync, since it runs for every
  // message regardless of whether it later turns out to be a transaction.
  const existingHashes = new Set(
    validMessages.length > 0
      ? (
          await RawSms.find({ hash: { $in: validMessages.map((v) => v.hash) } }, { hash: 1 }).lean()
        ).map((d) => d.hash)
      : []
  );

  // The raw-storage step has no cross-message dependency, so it's the one
  // part of this loop safe to do as a single bulk write instead of one
  // round-trip per message.
  const newEntries: Array<{ msg: IncomingSms; hash: string }> = [];
  for (const { msg, hash } of validMessages) {
    if (existingHashes.has(hash)) {
      duplicates += 1;
      continue;
    }
    // Two messages in the same batch can share a hash (e.g. an identical
    // promo/OTP SMS repeated) — the upfront query above can't see that.
    existingHashes.add(hash);
    newEntries.push({ msg, hash });
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

  // Parsing is pure CPU (no DB), so do it all up front — this tells us
  // exactly which docs need transaction work before touching the database
  // again, and isolates a parser bug on one message from the rest.
  const parsedEntries: Array<{ rawSms: InstanceType<typeof RawSms>; parsed: ParsedSms }> = [];
  for (const rawSms of createdDocs) {
    try {
      const parsed = parseSms(rawSms.body, rawSms.sender);
      if (parsed) parsedEntries.push({ rawSms, parsed });
    } catch (err) {
      failed += 1;
      console.error('Failed to parse one SMS in upload batch', {
        sender: rawSms.sender,
        receivedAt: rawSms.receivedAt,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  if (parsedEntries.length > 0) {
    const timestamps = parsedEntries.map((e) => e.rawSms.receivedAt.getTime());
    const since = new Date(Math.min(...timestamps) - MATCH_WINDOW_MS);
    const until = new Date(Math.max(...timestamps) + MATCH_WINDOW_MS);

    // One prefetch covering the whole batch's merge window instead of one
    // query per parsed message — the other dominant per-message DB cost.
    const existing = await Transaction.find({
      user: req.userId,
      transactionDate: { $gte: since, $lte: until },
    }).lean();

    const pool: PoolEntry[] = existing.map((t) => ({
      _id: t._id,
      type: t.type,
      amount: t.amount,
      transactionDate: t.transactionDate,
      bank: t.bank ?? undefined,
      merchant: t.merchant ?? undefined,
      accountLast4: t.accountLast4 ?? undefined,
      accountType: t.accountType ?? undefined,
      relatedRawSms: t.relatedRawSms ?? [],
      sourceCount: t.sourceCount ?? 1,
    }));

    const toCreate: Array<Record<string, unknown>> = [];
    const transactionUpdates: mongoose.AnyBulkWriteOperation[] = [];
    const rawSmsUpdates: mongoose.AnyBulkWriteOperation[] = [];

    for (const { rawSms, parsed } of parsedEntries) {
      const candidate = pickMergeCandidate(pool, parsed, rawSms.receivedAt);

      if (candidate) {
        // Same payment reported by a second SMS (e.g. bank alert + UPI app
        // confirmation) — link it instead of double-counting the spend.
        candidate.relatedRawSms = [...candidate.relatedRawSms, rawSms._id];
        candidate.sourceCount += 1;
        candidate.bank = candidate.bank ?? parsed.bank;
        candidate.merchant = candidate.merchant ?? parsed.merchant;
        candidate.accountLast4 = candidate.accountLast4 ?? parsed.accountLast4;
        candidate.accountType = candidate.accountType ?? parsed.accountType;

        transactionUpdates.push({
          updateOne: {
            filter: { _id: candidate._id },
            update: {
              $set: {
                relatedRawSms: candidate.relatedRawSms,
                sourceCount: candidate.sourceCount,
                bank: candidate.bank,
                merchant: candidate.merchant,
                accountLast4: candidate.accountLast4,
                accountType: candidate.accountType,
              },
            },
          },
        });
        rawSmsUpdates.push({
          updateOne: {
            filter: { _id: rawSms._id },
            update: { $set: { parsed: true, duplicateOfTransaction: candidate._id } },
          },
        });
        mergedCount += 1;
      } else {
        const { category, kind } = classifyMerchant(parsed.merchant);
        const newId = new mongoose.Types.ObjectId();
        const newEntry: PoolEntry = {
          _id: newId,
          type: parsed.type,
          amount: parsed.amount,
          transactionDate: rawSms.receivedAt,
          bank: parsed.bank,
          merchant: parsed.merchant,
          accountLast4: parsed.accountLast4,
          accountType: parsed.accountType,
          relatedRawSms: [],
          sourceCount: 1,
        };
        // Visible to subsequent messages in this same batch.
        pool.push(newEntry);

        toCreate.push({
          _id: newId,
          user: req.userId,
          rawSms: rawSms._id,
          amount: parsed.amount,
          type: parsed.type,
          category,
          kind,
          merchant: parsed.merchant,
          bank: parsed.bank,
          accountLast4: parsed.accountLast4,
          accountType: parsed.accountType,
          transactionDate: rawSms.receivedAt,
        });
      }
      parsedCount += 1;
    }

    // Flush in as few round-trips as possible instead of one write (or
    // three) per parsed message. rawSmsUpdates for the toCreate path is
    // built from whatever insertMany actually persisted, not from toCreate
    // itself — a RawSms must never be marked parsed:true when its
    // Transaction failed to save, or the money silently disappears with no
    // way to recover it (the raw SMS looks "handled" forever).
    if (toCreate.length > 0) {
      let insertedIds = new Set<string>(toCreate.map((doc) => String(doc._id)));
      try {
        await Transaction.insertMany(toCreate, { ordered: false });
      } catch (err) {
        const bulkErr = err as { insertedDocs?: Array<{ _id: unknown }> };
        insertedIds = new Set((bulkErr.insertedDocs ?? []).map((d) => String(d._id)));
        failed += toCreate.length - insertedIds.size;
        console.error('Some new transactions in upload batch failed to save', {
          attempted: toCreate.length,
          stored: insertedIds.size,
          error: err instanceof Error ? err.message : err,
        });
      }
      for (const doc of toCreate) {
        if (!insertedIds.has(String(doc._id))) continue;
        rawSmsUpdates.push({
          updateOne: { filter: { _id: doc.rawSms }, update: { $set: { parsed: true } } },
        });
      }
    }
    if (transactionUpdates.length > 0) {
      try {
        await Transaction.bulkWrite(transactionUpdates, { ordered: false });
      } catch (err) {
        console.error('Some merged-transaction updates in upload batch failed', {
          attempted: transactionUpdates.length,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
    if (rawSmsUpdates.length > 0) {
      try {
        await RawSms.bulkWrite(rawSmsUpdates, { ordered: false });
      } catch (err) {
        console.error('Some raw SMS parsed-flag updates in upload batch failed', {
          attempted: rawSmsUpdates.length,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  res.status(201).json({ stored, duplicates, parsed: parsedCount, merged: mergedCount, failed });
}
