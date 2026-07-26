export interface ParsedSms {
  amount: number;
  type: 'debit' | 'credit';
  merchant?: string;
  bank?: string;
  accountLast4?: string;
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
  { name: 'State Bank of India', pattern: /\bsbi\b/i },
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
  { name: 'India Post Payments Bank', pattern: /india\s?post/i },
  { name: 'Ujjivan Small Finance Bank', pattern: /ujjivan/i },
  { name: 'Central Bank of India', pattern: /central\s?bank/i },
  { name: 'Bank of India', pattern: /\bboi\b|bank of india/i },
  { name: 'Fino Payments Bank', pattern: /\bfino\b/i },
];

const AMOUNT_PATTERN = /(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;

const DEBIT_KEYWORDS =
  /\b(debited|debit|spent|paid|purchase(?:d)?|withdrawn|sent)\b/i;
const CREDIT_KEYWORDS =
  /\b(credited|credit|received|deposited|refunded|refund)\b/i;

const ACCOUNT_LAST4_PATTERN =
  /(?:a\/?c|acct|account|card)\.?\s*(?:no\.?)?\s*[xX*]{2,}(\d{3,6})/i;

const MERCHANT_PATTERNS: RegExp[] = [
  /\bat\s+([A-Za-z0-9&.\-_'*@ ]{2,40}?)(?=\s+on\s|\s+avl\b|\s+bal\b|[.,]|$)/i,
  /\bto\s+([A-Za-z0-9&.\-_'*@ ]{2,40}?)(?=\s+on\s|\s+avl\b|\s+bal\b|[.,]|$)/i,
  /\bfrom\s+([A-Za-z0-9&.\-_'*@ ]{2,40}?)(?=\s+on\s|\s+avl\b|\s+bal\b|[.,]|$)/i,
  /\bvpa\s+([\w.\-]+@[\w]+)/i,
  /([\w.\-]+@[\w]+)/,
];

function detectBank(sender: string | undefined, body: string): string | undefined {
  for (const { name, pattern } of BANK_SIGNATURES) {
    if (sender && pattern.test(sender)) return name;
  }
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

function extractMerchant(body: string): string | undefined {
  for (const pattern of MERCHANT_PATTERNS) {
    const match = body.match(pattern);
    const merchant = match?.[1]?.trim();
    if (merchant && !/^\d+$/.test(merchant)) {
      return merchant;
    }
  }
  return undefined;
}

export function parseSms(body: string, sender?: string): ParsedSms | null {
  const amountMatch = body.match(AMOUNT_PATTERN);
  if (!amountMatch) return null;

  const amount = Number(amountMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const type = detectType(body);
  if (!type) return null;

  const accountLast4 = body.match(ACCOUNT_LAST4_PATTERN)?.[1];
  const merchant = extractMerchant(body);
  const bank = detectBank(sender, body);

  return { amount, type, merchant, bank, accountLast4 };
}
