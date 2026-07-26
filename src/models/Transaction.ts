import { Schema, model, type InferSchemaType } from 'mongoose';

const transactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rawSms: { type: Schema.Types.ObjectId, ref: 'RawSms' },
    // Other SMS (e.g. bank debit alert + UPI app confirmation) matched to
    // this same real-world transaction — see services/transactionMatcher.ts.
    relatedRawSms: { type: [Schema.Types.ObjectId], ref: 'RawSms', default: [] },
    sourceCount: { type: Number, default: 1 },
    amount: { type: Number, required: true },
    type: { type: String, enum: ['debit', 'credit'], required: true },
    category: { type: String, default: 'uncategorized' },
    merchant: { type: String },
    bank: { type: String },
    accountLast4: { type: String },
    accountType: { type: String, enum: ['bank_account', 'credit_card', 'debit_card'] },
    transactionDate: { type: Date, required: true },
    kind: {
      type: String,
      enum: ['transaction', 'order', 'subscription', 'bill'],
      default: 'transaction',
    },
  },
  { timestamps: true }
);

// Backs both the merge-candidate prefetch in smsController (an equality +
// range scan, direction-agnostic) and the paginated transaction list (a
// descending sort with an _id tiebreaker for a stable cursor).
transactionSchema.index({ user: 1, transactionDate: -1, _id: -1 });

export type Transaction = InferSchemaType<typeof transactionSchema>;
export default model('Transaction', transactionSchema);
