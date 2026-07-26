export type TransactionKind = 'transaction' | 'order' | 'subscription' | 'bill';

interface Classification {
  category: string;
  kind: TransactionKind;
}

const MERCHANT_RULES: Array<{ pattern: RegExp; category: string; kind: TransactionKind }> = [
  // "Blink Commerce" is Blinkit's legal entity name — card-statement SMS
  // ("...spent...on BLINK COMMERCE") use it instead of the "Blinkit" brand.
  { pattern: /swiggy|zomato|blinkit|blink\s*commerce|instamart|zepto/i, category: 'Food', kind: 'order' },
  { pattern: /amazon|flipkart|meesho|myntra|reliance\s*retail|delhivery/i, category: 'Shopping', kind: 'order' },
  { pattern: /\bboat\b/i, category: 'Shopping', kind: 'order' },
  { pattern: /citymall|geddit/i, category: 'Groceries', kind: 'order' },
  { pattern: /innovative\s*reta/i, category: 'Shopping', kind: 'order' },
  { pattern: /uber|\bola\b|olacabs|rapido|irctc|indian\s*railway/i, category: 'Transport', kind: 'transaction' },
  { pattern: /netflix|spotify|hotstar|prime\s?video/i, category: 'Entertainment', kind: 'subscription' },
  { pattern: /district|bookmyshow/i, category: 'Entertainment', kind: 'transaction' },
  {
    pattern: /electricity|water\s?board|broadband|dth|gas\s?board|piped\s?gas|power\s?corp|\buppcl\b/i,
    category: 'Bills',
    kind: 'bill',
  },
  { pattern: /salary/i, category: 'Income', kind: 'transaction' },
  // Paytm parent entity's settlement SMS, plus payment-gateway/aggregator
  // pass-through merchants (Razorpay, Omniware) — a transfer/settlement, not
  // a purchase, so these get their own bucket rather than Shopping.
  { pattern: /one\s*97\s*communications|razorpay|omniware/i, category: 'Transaction', kind: 'transaction' },
  // Anchored (^...$) rather than a bare substring match — "transfer" and
  // "dispute" are common English words that could otherwise false-positive
  // inside an unrelated merchant name; these are known P2P/person merchant
  // strings, not category keywords to search for broadly.
  {
    pattern: /^(?:ms\s*rajesh\s*kiran|ramesh@oksbi|dispute|transfer)$/i,
    category: 'Transfer',
    kind: 'transaction',
  },
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
