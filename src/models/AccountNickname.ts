import { Schema, model, type InferSchemaType } from 'mongoose';

const accountNicknameSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bank: { type: String, required: true },
    // Normalized to '' rather than left undefined so the compound unique
    // index below behaves consistently across every doc for this user.
    accountLast4: { type: String, default: '' },
    nickname: { type: String, required: true, trim: true, maxlength: 40 },
  },
  { timestamps: true }
);

// Identity is bank + last4 only — accountType isn't part of it, since a
// single physical card's own SMS don't all classify accountType identically.
accountNicknameSchema.index({ user: 1, bank: 1, accountLast4: 1 }, { unique: true });

export type AccountNickname = InferSchemaType<typeof accountNicknameSchema>;
export default model('AccountNickname', accountNicknameSchema);
