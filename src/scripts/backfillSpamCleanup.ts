// One-off cleanup for transactions created before the smsParser spam filter,
// stricter bank-detection, accountType (bank account vs. credit/debit card),
// and VPA-merchant/pending-mandate/pending-settlement/no-source-identified
// rules landed (see services/smsParser.ts). Re-parses every stored
// transaction's original SMS under the current rules:
//   - if the SMS is now recognized as spam/promo/pending/unidentified-source
//     -> delete the transaction
//   - if the bank was a false-positive body-scan match -> unset/correct it
//   - fill in/correct accountType so Banks & cards can tell them apart
//   - normalize accountLast4 to the last 4 digits so the same physical
//     account doesn't split into duplicate Banks & cards entries when
//     different SMS templates mask a different number of digits
//   - fill in/correct merchant (and re-derive category/kind from it) now that
//     VPA handles no longer get blanked out by a coincidental bank-name match
//
// Run with: npm run backfill:spam-cleanup
import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import RawSms from '../models/RawSms';
import Transaction from '../models/Transaction';
import { classifyMerchant } from '../services/merchantClassifier';
import { parseSms } from '../services/smsParser';

async function run(): Promise<void> {
  await connectDB();

  let deleted = 0;
  let bankCorrected = 0;
  let accountTypeCorrected = 0;
  let merchantCorrected = 0;
  let accountLast4Corrected = 0;
  let scanned = 0;

  const cursor = Transaction.find({ rawSms: { $ne: null } }).cursor();

  for await (const tx of cursor) {
    scanned += 1;
    const rawSms = await RawSms.findById(tx.rawSms).lean();
    if (!rawSms) continue;

    const reparsed = parseSms(rawSms.body, rawSms.sender);

    if (!reparsed) {
      // Now classified as spam — remove the bogus transaction and unlink any
      // other SMS that had been merged into it so they don't point at a
      // deleted document.
      await RawSms.updateMany(
        { duplicateOfTransaction: tx._id },
        { $unset: { duplicateOfTransaction: 1 }, $set: { parsed: false } }
      );
      await Transaction.deleteOne({ _id: tx._id });
      deleted += 1;
      continue;
    }

    let changed = false;

    if ((reparsed.bank ?? null) !== (tx.bank ?? null)) {
      tx.bank = reparsed.bank ?? undefined;
      changed = true;
      bankCorrected += 1;
    }

    if ((reparsed.accountType ?? null) !== (tx.accountType ?? null)) {
      tx.accountType = reparsed.accountType ?? undefined;
      changed = true;
      accountTypeCorrected += 1;
    }

    if ((reparsed.accountLast4 ?? null) !== (tx.accountLast4 ?? null)) {
      tx.accountLast4 = reparsed.accountLast4 ?? undefined;
      changed = true;
      accountLast4Corrected += 1;
    }

    if ((reparsed.merchant ?? null) !== (tx.merchant ?? null)) {
      tx.merchant = reparsed.merchant ?? undefined;
      // Category/kind are derived from merchant, so a merchant correction
      // can only be trusted alongside a matching re-classification —
      // otherwise a transaction picks up a new merchant name but keeps a
      // stale category from the old (missing) one.
      const { category, kind } = classifyMerchant(reparsed.merchant);
      tx.category = category;
      tx.kind = kind;
      changed = true;
      merchantCorrected += 1;
    }

    if (changed) await tx.save();
  }

  console.log(`Scanned ${scanned} transactions.`);
  console.log(`Deleted ${deleted} spam-derived transactions.`);
  console.log(`Corrected bank on ${bankCorrected} transactions.`);
  console.log(`Corrected accountType on ${accountTypeCorrected} transactions.`);
  console.log(`Corrected accountLast4 on ${accountLast4Corrected} transactions.`);
  console.log(`Corrected merchant/category on ${merchantCorrected} transactions.`);

  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfillSpamCleanup failed', err);
    process.exit(1);
  });
