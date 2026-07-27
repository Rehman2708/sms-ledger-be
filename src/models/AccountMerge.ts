import { Schema, model, type InferSchemaType } from 'mongoose';

const accountMergeSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // The identity being folded away — normalized to '' rather than left
    // undefined, matching AccountNickname, so the compound unique index
    // below behaves consistently across every doc for this user.
    bank: { type: String, required: true },
    accountLast4: { type: String, default: '' },
    // The identity it now displays as. Always a real (non-aliased) identity
    // — mergeAccounts repoints existing aliases rather than ever chaining
    // one alias to another, so resolution is always a single lookup.
    canonicalBank: { type: String, required: true },
    canonicalAccountLast4: { type: String, default: '' },
  },
  { timestamps: true }
);

// An identity can only be merged away into one canonical at a time.
accountMergeSchema.index({ user: 1, bank: 1, accountLast4: 1 }, { unique: true });

export type AccountMerge = InferSchemaType<typeof accountMergeSchema>;
export default model('AccountMerge', accountMergeSchema);
