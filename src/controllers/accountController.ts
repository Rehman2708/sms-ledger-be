import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import AccountMerge from '../models/AccountMerge';
import AccountNickname from '../models/AccountNickname';

export async function listAccountNicknames(req: AuthedRequest, res: Response): Promise<void> {
  const accounts = await AccountNickname.find({ user: req.userId }).lean();
  res.json({ accounts });
}

export async function upsertAccountNickname(req: AuthedRequest, res: Response): Promise<void> {
  const { bank: rawBank, accountLast4, nickname } = req.body ?? {};

  if (typeof rawBank !== 'string' || !rawBank.trim()) {
    res.status(400).json({ message: 'bank is required' });
    return;
  }
  if (typeof nickname !== 'string' || !nickname.trim()) {
    res.status(400).json({ message: 'nickname is required' });
    return;
  }
  // Untrimmed bank strings ("HDFC" vs "HDFC ") would otherwise pass the
  // compound unique index as distinct docs for what's really the same bank.
  const bank = rawBank.trim();

  const filter = {
    user: req.userId,
    bank,
    accountLast4: typeof accountLast4 === 'string' ? accountLast4 : '',
  };

  // Filter's accountLast4 is a runtime-validated string, not the schema's
  // literal-union type, which is enough to make TS pick the wrong
  // findOneAndUpdate overload — the filter shape itself is correct.
  const account = await AccountNickname.findOneAndUpdate(
    filter as Record<string, unknown>,
    { $set: { nickname: nickname.trim() } },
    { upsert: true, new: true }
  );

  res.json({ account });
}

interface IdentityInput {
  bank: string;
  accountLast4?: string;
}

interface NormalizedIdentity {
  bank: string;
  accountLast4: string;
}

function normalizeIdentity(raw: unknown): NormalizedIdentity | null {
  const obj = raw as IdentityInput;
  if (typeof obj?.bank !== 'string' || !obj.bank.trim()) return null;
  return {
    bank: obj.bank.trim(),
    accountLast4: typeof obj.accountLast4 === 'string' ? obj.accountLast4 : '',
  };
}

function sameIdentity(a: NormalizedIdentity, b: NormalizedIdentity): boolean {
  return a.bank === b.bank && a.accountLast4 === b.accountLast4;
}

export async function listAccountMerges(req: AuthedRequest, res: Response): Promise<void> {
  const merges = await AccountMerge.find({ user: req.userId }).lean();
  res.json({ merges });
}

// Folds 2+ account identities (bank + last4, same shape the mobile app
// already groups Banks & cards by) into one — for when the parser genuinely
// can't tell two SMS templates describe the same real account (e.g. one
// never discloses a masked account number at all) and it shows up as
// separate entries. Deliberately non-destructive: no Transaction document is
// touched, so this stays reversible (see unmergeAccount) and survives future
// syncs without needing to be re-applied — every read that groups by account
// resolves through this mapping instead of the raw stored bank/accountLast4.
export async function mergeAccounts(req: AuthedRequest, res: Response): Promise<void> {
  const { identities: rawIdentities, canonicalIndex } = req.body ?? {};

  if (!Array.isArray(rawIdentities) || rawIdentities.length < 2) {
    res.status(400).json({ message: 'identities must be an array of at least 2 accounts' });
    return;
  }
  if (
    typeof canonicalIndex !== 'number' ||
    !Number.isInteger(canonicalIndex) ||
    canonicalIndex < 0 ||
    canonicalIndex >= rawIdentities.length
  ) {
    res.status(400).json({ message: 'canonicalIndex must index into identities' });
    return;
  }

  const identities: NormalizedIdentity[] = [];
  for (const raw of rawIdentities) {
    const identity = normalizeIdentity(raw);
    if (!identity) {
      res.status(400).json({ message: 'each identity needs a bank' });
      return;
    }
    identities.push(identity);
  }

  const canonical = identities[canonicalIndex];
  // De-duped so a client accidentally sending the same identity twice (or
  // the canonical among "others") can't create a self-referencing alias.
  const others = identities.filter(
    (identity, i) =>
      i !== canonicalIndex &&
      !sameIdentity(identity, canonical) &&
      identities.findIndex((x) => sameIdentity(x, identity)) === i
  );

  if (others.length === 0) {
    res.status(400).json({ message: 'need at least one other distinct account to merge' });
    return;
  }

  // Any alias that currently points AT one of the identities being folded
  // away must be repointed straight to the new canonical — otherwise it'd be
  // left pointing at something that's now itself just an alias, and
  // resolution (both here and client-side) only ever does a single hop by
  // design, to keep it O(1) instead of needing to walk a chain.
  await AccountMerge.updateMany(
    {
      user: req.userId,
      $or: others.map((o) => ({ canonicalBank: o.bank, canonicalAccountLast4: o.accountLast4 })),
    },
    { $set: { canonicalBank: canonical.bank, canonicalAccountLast4: canonical.accountLast4 } }
  );

  // If the chosen canonical was itself previously an alias of something
  // else, it's the root now — drop that stale mapping.
  await AccountMerge.deleteOne({
    user: req.userId,
    bank: canonical.bank,
    accountLast4: canonical.accountLast4,
  });

  await Promise.all(
    others.map((o) =>
      AccountMerge.findOneAndUpdate(
        { user: req.userId, bank: o.bank, accountLast4: o.accountLast4 },
        { $set: { canonicalBank: canonical.bank, canonicalAccountLast4: canonical.accountLast4 } },
        { upsert: true }
      )
    )
  );

  const merges = await AccountMerge.find({ user: req.userId }).lean();
  res.json({ merges });
}

// Un-merges a single identity, restoring it as its own separate account —
// the reversibility half of mergeAccounts.
export async function unmergeAccount(req: AuthedRequest, res: Response): Promise<void> {
  const { bank, accountLast4 } = req.query;
  if (typeof bank !== 'string' || !bank.trim()) {
    res.status(400).json({ message: 'bank is required' });
    return;
  }
  await AccountMerge.deleteOne({
    user: req.userId,
    bank: bank.trim(),
    accountLast4: typeof accountLast4 === 'string' ? accountLast4 : '',
  });
  res.status(204).send();
}
