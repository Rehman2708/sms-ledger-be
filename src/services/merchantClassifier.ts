export type TransactionKind = 'transaction' | 'order' | 'subscription' | 'bill';

interface Classification {
  category: string;
  kind: TransactionKind;
}

const MERCHANT_RULES: Array<{ pattern: RegExp; category: string; kind: TransactionKind }> = [
  { pattern: /swiggy|zomato|blinkit|instamart|zepto/i, category: 'Food', kind: 'order' },
  { pattern: /amazon|flipkart|meesho/i, category: 'Shopping', kind: 'order' },
  { pattern: /\bboat\b/i, category: 'Shopping', kind: 'order' },
  { pattern: /uber|\bola\b|rapido|irctc/i, category: 'Transport', kind: 'transaction' },
  { pattern: /netflix|spotify|hotstar|prime\s?video/i, category: 'Entertainment', kind: 'subscription' },
  { pattern: /district|bookmyshow/i, category: 'Entertainment', kind: 'transaction' },
  {
    pattern: /electricity|water\s?board|broadband|dth|gas\s?board|piped\s?gas/i,
    category: 'Bills',
    kind: 'bill',
  },
  { pattern: /salary/i, category: 'Income', kind: 'transaction' },
];

export function classifyMerchant(merchant?: string): Classification {
  if (merchant) {
    for (const rule of MERCHANT_RULES) {
      if (rule.pattern.test(merchant)) {
        return { category: rule.category, kind: rule.kind };
      }
    }
  }
  return { category: 'uncategorized', kind: 'transaction' };
}
