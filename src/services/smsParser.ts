export type AccountType = 'bank_account' | 'credit_card' | 'debit_card';

export interface ParsedSms {
  amount: number;
  type: 'debit' | 'credit';
  merchant?: string;
  bank?: string;
  accountLast4?: string;
  accountType?: AccountType;
}

interface BankSignature {
  name: string;
  pattern: RegExp;
}

const BANK_SIGNATURES: BankSignature[] = [
  // SBI Card is a separate product/sender from SBI itself — must be checked
  // before the "State Bank of India" \bsbi\b pattern below.
  { name: 'SBI Card', pattern: /sbi\s*card/i },
  { name: 'HDFC Bank', pattern: /hdfc/i },
  { name: 'ICICI Bank', pattern: /icici/i },
  // No \b around "sbi" — real sender IDs glue it to a suffix with no
  // separator (SBIUPI, SBIBNK, SBIINB, SBIPSG, SBICARD, ATMSBI), so a
  // strict word-boundary match misses most of them. "yono" catches SBI's
  // YONO app senders (e.g. SBYONO), which drop the "i" entirely.
  { name: 'State Bank of India', pattern: /sbi|yono/i },
  { name: 'Axis Bank', pattern: /axis/i },
  { name: 'Kotak Mahindra Bank', pattern: /kotak/i },
  { name: 'Punjab National Bank', pattern: /\bpnb\b/i },
  { name: 'Yes Bank', pattern: /yes\s?bank|yesbnk/i },
  { name: 'IDFC First Bank', pattern: /idfc/i },
  { name: 'IDBI Bank', pattern: /idbi/i },
  { name: 'IndusInd Bank', pattern: /indus/i },
  { name: 'Bank of Baroda', pattern: /\bbob\b|bank of baroda/i },
  { name: 'Punjab & Sind Bank', pattern: /psb/i },
  { name: 'Canara Bank', pattern: /canara/i },
  { name: 'Union Bank of India', pattern: /union\s?bank|\bubi\b/i },
  { name: 'RBL Bank', pattern: /\brbl\b/i },
  { name: 'UCO Bank', pattern: /\buco\b/i },
  { name: 'Indian Bank', pattern: /indian\s?bank/i },
  { name: 'Jio Payments Bank', pattern: /\bjio\b/i },
  { name: 'Dhanlaxmi Bank', pattern: /dhanlaxmi/i },
  { name: 'Federal Bank', pattern: /federal/i },
  { name: 'Bank of Maharashtra', pattern: /maharashtra/i },
  { name: 'India Post Payments Bank', pattern: /india\s?post|\bippb\b|dopbnk|dopcbs/i },
  { name: 'Ujjivan Small Finance Bank', pattern: /ujjivan/i },
  { name: 'Central Bank of India', pattern: /central\s?bank/i },
  // No \b after "boi" — sender IDs glue it to a suffix (BOIIND, BOICMP).
  { name: 'Bank of India', pattern: /\bboi|bank of india/i },
  { name: 'Fino Payments Bank', pattern: /\bfino\b/i },
  { name: 'DBS Bank', pattern: /\bdbs\b/i },
  // "pytm" catches abbreviated sender IDs that drop the "a" (PYTMBK, PYTMPS).
  { name: 'Paytm Payments Bank', pattern: /paytm|pytm/i },
  { name: 'Airtel Payments Bank', pattern: /airbnk|airtel\s*payments?\s*bank/i },
];

const AMOUNT_PATTERN = /(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;

// Bare "debit"/"credit" must not match when they're really naming the
// *instrument* ("Credit Card XX0007", "Debit Card XX1234") rather than
// describing money movement — otherwise an OTP alert that only mentions
// "...on ICICI Bank Credit Card XX0007" gets misread as a completed credit
// transaction (see OTP_PATTERN below for the other half of that fix).
const DEBIT_KEYWORDS =
  /\b(debited|spent|paid|purchase(?:d)?|withdrawn|sent)\b|\bdebit\b(?!\s*card)/i;
const CREDIT_KEYWORDS =
  /\b(credited|received|deposited|refunded|refund)\b|\bcredit\b(?!\s*card)/i;

// OTP/authorization prompts ("143732 is OTP for txn of INR 1002.00 at
// FLIPKART PA on ICICI Bank Credit Card XX0007") describe a *pending*
// transaction, not a completed one — the bank sends a separate debit/credit
// alert once it actually goes through. Never let these become transactions.
const OTP_PATTERN = /\botp\b/i;

// UPI Mandate/AutoPay setup, teardown, and pre-execution notices ("is
// scheduled on 09/01/2025", "Approve your automatic payment", "Mandate is
// successfully created/revoked") describe the *mandate*, not money having
// actually moved yet — the real debit (if any) arrives as its own alert on
// the execution date. Without this, a recurring mandate reminder creates a
// phantom transaction every cycle before the real debit even happens.
const PENDING_MANDATE_PATTERN =
  /\b(?:is\s+scheduled\s+on|will\s+be\s+(?:debited|charged|presented)\s+on|mandate\s+is\s+successfully\s+(?:created|revoked)|approve\s+your\s+automatic\s+payment)\b/i;

// Refund/settlement-in-flight notices ("is being processed", "will reflect
// in 5-7 business days", "refund ... initiated") describe money that has
// been promised but not yet moved — same pending-vs-completed distinction as
// OTP/mandate above, just for the credit side.
const PENDING_SETTLEMENT_PATTERN =
  /\b(?:is\s+being\s+processed|will\s+(?:reflect|get\s+credited|be\s+credited)\s+in\s+\d|refund\b[^.]{0,40}\binitiated\b)\b/i;

// Card/account statement notices ("Statement is sent to you@gmail.com",
// "e-Statement generated") report a billing summary, not a completed
// transaction — the "Total of Rs X" figure is the outstanding balance across
// the whole cycle, not a single movement. Without this, the bare "sent" in
// "Statement is sent to ..." matches DEBIT_KEYWORDS below and the cycle total
// becomes a phantom debit transaction.
const STATEMENT_PATTERN = /\bstatement\s+(?:is\s+)?(?:sent|generated|dispatched)\b/i;

// Promo/marketing SMS routinely mention a real bank name and can coincidentally
// contain a debit/credit keyword + amount (e.g. "Get Rs.5000 cashback credited
// instantly, apply now"). Reject these outright before any amount/bank parsing
// so they never turn into a fake transaction.
const SPAM_PATTERNS: RegExp[] = [
  /\bcashback\b/i,
  /\b(pre[- ]?approved|instant\s+loan|personal\s+loan|loan\s+offer|credit\s+limit\s+(?:enhanced|increased)|emi\s+offer)\b/i,
  // Loan/EMI marketing that doesn't use the words above but leans on credit
  // score jargon instead (e.g. "Your CIBIL qualifies you for Rs.71,800 Freo
  // credit", "EMI of Rs.3,385 for 24 months", "INSTANT Disbursal").
  /\b(cibil|disbursal|qualifies\s+you\s+for|monthly\s+interest|emi\s+of\s+rs\.?\s*[\d,]+)\b/i,
  /\b(congratulations|you\s*(?:'ve|have)\s+won|lucky\s+draw|lottery|jackpot)\b/i,
  /\b(click\s+here|click\s+the\s+link|t&c\s+apply|terms\s+and\s+conditions\s+apply|apply\s+now|limited\s+period\s+offer|hurry\s?,?\s*offer)\b/i,
  /\b(flat\s+\d+%|upto\s+\d+%|up\s+to\s+\d+%\s+off|% off|discount\s+of)\b/i,
  /\bunsubscribe\b/i,
  // Balance disclosure, not a movement ("You have a credit balance of INR
  // 24.25 ... to request a refund").
  /\bcredit\s+balance\s+of\b/i,
];

function isSpam(body: string): boolean {
  return SPAM_PATTERNS.some((pattern) => pattern.test(body));
}

// Split so we know *which* keyword backed the masked number — that's what
// tells a bank account apart from a card (see detectAccountType below).
// Mask width varies by template — some banks mask with a single "X" (e.g.
// "A/c X9560"), not just "XX"/"****" — so {1,} here, not {2,}, or those SMS
// never capture an account ref at all and the same real account ends up
// split into a with-ref and a without-ref entry in the Banks & cards list.
const BANK_ACCOUNT_REF_PATTERN = /(?:a\/?c|acct|account)\.?\s*(?:no\.?)?\s*[xX*]{1,}(\d{3,6})/i;
const CARD_REF_PATTERN = /card\.?\s*(?:no\.?)?\s*[xX*]{1,}(\d{3,6})/i;

// "Avl Lmt" is ICICI's own abbreviation for "Available Limit" — without the
// `lmt` alternative here, those SMS fall through to the matchedVia==='card'
// default of debit_card and mislabel a real credit-card purchase.
const CREDIT_CARD_HINTS =
  /\bcredit\s*card\b|\b(?:credit\s*limit|available\s*limit|avl\s*lim(?:it|t)|minimum\s*(?:amount|payment)\s*due|total\s*(?:amount\s*)?due|statement\s*(?:generated|date)|outstanding\s*balance)\b/i;
const DEBIT_CARD_HINTS = /\bdebit\s*card\b/i;

function detectAccountType(
  body: string,
  bank: string | undefined,
  matchedVia: 'account' | 'card' | undefined
): AccountType | undefined {
  if (DEBIT_CARD_HINTS.test(body)) return 'debit_card';
  if (CREDIT_CARD_HINTS.test(body)) return 'credit_card';
  if (bank === 'SBI Card') return 'credit_card'; // SBI Card only issues credit cards.
  if (matchedVia === 'card') return 'debit_card'; // "card" alone, no credit signal — most often a debit card swipe.
  if (matchedVia === 'account') return 'bank_account';
  return undefined;
}

const MERCHANT_PATTERNS: RegExp[] = [
  /\bat\s+([A-Za-z0-9&.\-_'*@ ]{2,40}?)(?=\s+on\s|\s+avl\b|\s+bal\b|[.,]|$)/i,
  /\bto\s+([A-Za-z0-9&.\-_'*@ ]{2,40}?)(?=\s+on\s|\s+avl\b|\s+bal\b|[.,]|$)/i,
  /\bfrom\s+([A-Za-z0-9&.\-_'*@ ]{2,40}?)(?=\s+on\s|\s+avl\b|\s+bal\b|[.,]|$)/i,
  // ICICI card alerts phrase the merchant as a second "on", after the
  // transaction date's own "on" ("...Card XX0007 on 07-Jun-26 on BLINKIT."):
  // anchored on the date so it can't be confused with a bare "on <date>".
  /\bon\s+\d{1,2}[-/][A-Za-z]{3,9}[-/]\d{2,4}\s+on\s+([A-Za-z0-9&.\-_'*@ ]{2,40}?)(?=\s+avl\b|\s+bal\b|[.,]|$)/i,
  // Merchant-issued refund alerts open with the merchant's own name before
  // ever mentioning "refund" ("BLINKIT refund of Rs 70.00 credited to...").
  /^\s*([A-Za-z0-9&.\-_'* ]{2,40}?)\s+refund\s+of\s+(?:rs\.?|inr)/i,
  /\bvpa\s+([\w.\-]+@[\w]+)/i,
  /([\w.\-]+@[\w]+)/,
];

// extractMerchant needs the 'g' flag to walk every match with matchAll, but
// building a new RegExp from source/flags on every single SMS (every call)
// is wasted work for what's a fixed, static pattern set — compile once.
const GLOBAL_MERCHANT_PATTERNS = MERCHANT_PATTERNS.map(
  (pattern) => new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
);

function detectBank(sender: string | undefined, body: string, hasAccountRef: boolean): string | undefined {
  for (const { name, pattern } of BANK_SIGNATURES) {
    if (sender && pattern.test(sender)) return name;
  }
  // The sender didn't identify the bank — only trust a name mentioned inside
  // the body if there's a masked account/card number backing it up. Real bank
  // alerts always carry one; marketing SMS that merely namedrop a bank don't.
  if (!hasAccountRef) return undefined;
  for (const { name, pattern } of BANK_SIGNATURES) {
    if (pattern.test(body)) return name;
  }
  return undefined;
}

function detectType(body: string): 'debit' | 'credit' | null {
  const debitMatch = body.match(DEBIT_KEYWORDS);
  const creditMatch = body.match(CREDIT_KEYWORDS);

  if (debitMatch && creditMatch) {
    return debitMatch.index! <= creditMatch.index! ? 'debit' : 'credit';
  }
  if (debitMatch) return 'debit';
  if (creditMatch) return 'credit';
  return null;
}

// The "at/to/from X" patterns above match ordinary sentence structure just
// as often as an actual merchant name — "debited from your account", "to
// request a refund", "sent to anyone" — so a captured candidate has to pass
// a sanity check before it's trusted as a real merchant.
const MERCHANT_NOISE_PREFIX =
  /^(your|you|anyone|someone|insufficient|available|outstanding|minimum|total|request|access|manage|click)\b/i;
const CURRENCY_ONLY_PATTERN = /^(?:rs\.?|inr)?\s*[\d,]+(?:\.\d+)?$/i;
const LEADING_NUMBER_PATTERN = /^\d+\s+\w/;

function looksLikeMerchant(candidate: string, bank: string | undefined): boolean {
  if (MERCHANT_NOISE_PREFIX.test(candidate)) return false;
  if (CURRENCY_ONLY_PATTERN.test(candidate)) return false;
  if (LEADING_NUMBER_PATTERN.test(candidate)) return false;
  const isEmailLike = /[@.]/.test(candidate);
  // The *issuing* bank's own name isn't a merchant — this catches captures
  // like "ICICI Bank Credit Card XX0007" off a card/limit alert with no real
  // payee. Only compare against the bank actually detected for this SMS, not
  // every known bank signature: several banks double as common merchant
  // names in card-spend alerts (e.g. "on PAYTM UTILITY" for a Paytm bill
  // paid via an ICICI card) and would otherwise get wiped out just for
  // sharing a name with some unrelated bank. Skip this for VPA/email-like
  // candidates: handles routinely embed a bank's abbreviation in the PSP
  // suffix (ramesh@oksbi, x@okhdfcbank, x@ybl) which isn't the bank being
  // named as payee, so the check would wrongly blank out a legitimate UPI
  // counterparty.
  if (!isEmailLike && bank) {
    const issuingBank = BANK_SIGNATURES.find(({ name }) => name === bank);
    if (issuingBank?.pattern.test(candidate)) return false;
  }
  // Real merchant names in these SMS are written in caps or title case; a
  // plain lowercase multi-word phrase (that isn't an email/VPA) is almost
  // always leftover sentence filler, not a brand name.
  if (!isEmailLike && /\s/.test(candidate) && candidate === candidate.toLowerCase()) return false;
  return true;
}

// Fallback brand list, mirrored from mobile/src/assets/brandAssets.ts
// MERCHANT_LOGOS — when none of the structured "at/to/from X" patterns above
// capture a merchant (unusual SMS phrasing that doesn't fit those shapes),
// scan the whole body for a recognizable brand name instead so the
// transaction still gets a real logo client-side rather than falling back to
// a plain category glyph. selfBankName marks entries that double as a bank's
// own name (Paytm/Jio also issue payment-bank accounts) — skipped when that
// bank is the one issuing this very SMS, since that's a self-reference
// ("your Jio Payments Bank a/c"), not a merchant.
const KNOWN_BRAND_PATTERNS: Array<{ pattern: RegExp; selfBankName?: string }> = [
  { pattern: /flipkart\s*minutes/i },
  { pattern: /flipkart/i },
  { pattern: /swiggy/i },
  { pattern: /zomato/i },
  { pattern: /blinkit/i },
  { pattern: /instamart/i },
  { pattern: /zepto/i },
  { pattern: /amazon/i },
  { pattern: /meesho/i },
  { pattern: /\buber\b/i },
  { pattern: /\bola\b|olacabs/i },
  { pattern: /rapido/i },
  { pattern: /irctc/i },
  { pattern: /netflix/i },
  { pattern: /\bboat\b/i },
  { pattern: /district/i },
  { pattern: /burger\s*king/i },
  { pattern: /\btoing\b/i },
  { pattern: /jio\s*mart/i },
  { pattern: /myntra/i },
  { pattern: /big\s*basket/i },
  { pattern: /domino'?s?/i },
  { pattern: /jio\s*pay/i, selfBankName: 'Jio Payments Bank' },
  { pattern: /google\s*pay|\bgpay\b/i },
  { pattern: /phonepe/i },
  { pattern: /paytm|one\s?97\s?communications/i, selfBankName: 'Paytm Payments Bank' },
];

function extractKnownBrand(body: string, bank: string | undefined): string | undefined {
  for (const { pattern, selfBankName } of KNOWN_BRAND_PATTERNS) {
    if (selfBankName && selfBankName === bank) continue;
    const match = body.match(pattern);
    if (match) return match[0].trim();
  }
  return undefined;
}

function extractMerchant(body: string, bank: string | undefined): string | undefined {
  for (const pattern of GLOBAL_MERCHANT_PATTERNS) {
    for (const match of body.matchAll(pattern)) {
      const merchant = match[1]?.trim();
      if (!merchant || /^\d+$/.test(merchant)) continue;
      if (!looksLikeMerchant(merchant, bank)) continue;
      // The "from"/"to" patterns can capture the leading "VPA " protocol
      // label along with the actual counterparty handle (e.g. "from VPA
      // ramesh@oksbi") — that label isn't part of the payee's identity.
      return merchant.replace(/^vpa\s+/i, '');
    }
  }
  return extractKnownBrand(body, bank);
}

export function parseSms(body: string, sender?: string): ParsedSms | null {
  if (isSpam(body)) return null;
  if (OTP_PATTERN.test(body)) return null;
  if (PENDING_MANDATE_PATTERN.test(body)) return null;
  if (PENDING_SETTLEMENT_PATTERN.test(body)) return null;
  if (STATEMENT_PATTERN.test(body)) return null;

  const amountMatch = body.match(AMOUNT_PATTERN);
  if (!amountMatch) return null;

  const amount = Number(amountMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const type = detectType(body);
  if (!type) return null;

  const accountMatch = body.match(BANK_ACCOUNT_REF_PATTERN);
  const cardMatch = body.match(CARD_REF_PATTERN);
  // Banks mask a different number of trailing digits across SMS templates
  // (e.g. "XX1234" vs "XXXXXX561234") for the *same* physical account — the
  // capture group is 3-6 digits wide, so without normalizing to the last 4
  // the same account produces two different accountLast4 values and shows up
  // as two separate entries in the Banks & cards list (accountKey in
  // mobile/src/utils/accountGrouping.ts keys strictly on bank+accountLast4).
  const accountLast4 = (accountMatch?.[1] ?? cardMatch?.[1])?.slice(-4);
  const matchedVia = accountMatch ? 'account' : cardMatch ? 'card' : undefined;
  const bank = detectBank(sender, body, Boolean(accountLast4));

  // A genuine bank/card alert always identifies either the issuing bank (via
  // a recognized sender ID or, backed by an account/card ref, a name in the
  // body) or a masked account/card number. Messages with neither are wallet
  // top-ups, mobile recharges, loan/EMI marketing, or a third-party "we
  // received your payment" receipt (Acko, traffic e-challan, etc.) — never
  // an actual movement in the user's own bank/card — so treat them as
  // unparseable instead of fabricating a transaction with no source.
  if (!bank && !accountLast4) return null;

  const merchant = extractMerchant(body, bank);
  const accountType = detectAccountType(body, bank, matchedVia);

  return { amount, type, merchant, bank, accountLast4, accountType };
}
