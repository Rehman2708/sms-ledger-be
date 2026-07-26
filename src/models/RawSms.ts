import { Schema, model, type InferSchemaType } from 'mongoose';

const rawSmsSchema = new Schema(
  {
    // No standalone index here — the compound {user,receivedAt} index below
    // already serves user-only queries as its prefix, so a separate
    // single-field index would just double the write cost for no benefit.
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sender: { type: String, required: true },
    body: { type: String, required: true },
    receivedAt: { type: Date, required: true },
    hash: { type: String, required: true, unique: true },
    parsed: { type: Boolean, default: false },
    // Set when this SMS was matched to an already-recorded transaction
    // (e.g. a bank debit alert arriving after the UPI app's own SMS for the
    // same payment) instead of creating a second Transaction.
    duplicateOfTransaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  },
  { timestamps: true }
);

// Backs getSyncCursor's {user}.sort({receivedAt:-1}) — the single-field
// index on `user` alone doesn't cover that sort at scale.
rawSmsSchema.index({ user: 1, receivedAt: -1 });

export type RawSms = InferSchemaType<typeof rawSmsSchema>;
export default model('RawSms', rawSmsSchema);
