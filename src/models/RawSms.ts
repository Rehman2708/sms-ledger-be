import { Schema, model, type InferSchemaType } from 'mongoose';

const rawSmsSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
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

export type RawSms = InferSchemaType<typeof rawSmsSchema>;
export default model('RawSms', rawSmsSchema);
