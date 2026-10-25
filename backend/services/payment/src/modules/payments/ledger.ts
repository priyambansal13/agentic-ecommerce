/**
 * Double-entry ledger postings (pure). Every transaction is balanced: Σdebit = Σcredit.
 * Accounts: gateway:clearing (money held by the gateway), seller:<id>:payable, platform:shipping,
 * platform:fees, tax:gst_payable. Same chart of accounts as the demo seed.
 *   CAPTURE  Dr gateway:clearing total        Cr seller payables (their line gross) + platform:shipping (rest)
 *   FEE      Dr seller payable (fees + GST)    Cr platform:fees, tax:gst_payable          (one tx per seller)
 *   REFUND   Dr seller payables (+ shipping)   Cr gateway:clearing                         (allocated pro rata)
 *   FEE (reversal on cancel-before-ship) mirrors the FEE tx.
 */
import { lineFees, type FeeScheduleTerms } from '../fees/fee-math.js';

export interface Posting { account: string; debit: number; credit: number }
export interface PaymentLine { sellerId: string; productId: string | null; category: string; qty: number; unitPriceMinor: number }

export const sellerAccount = (sellerId: string) => `seller:${sellerId}:payable`;

export function grossBySeller(lines: PaymentLine[]) {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.sellerId, (m.get(l.sellerId) ?? 0) + l.qty * l.unitPriceMinor);
  return m;
}

export function capturePostings(totalMinor: number, lines: PaymentLine[]): Posting[] {
  const gross = grossBySeller(lines);
  const goods = [...gross.values()].reduce((a, b) => a + b, 0);
  if (goods > totalMinor) throw new Error(`order lines (${goods}) exceed the captured amount (${totalMinor})`);
  const p: Posting[] = [{ account: 'gateway:clearing', debit: totalMinor, credit: 0 }];
  for (const [sellerId, g] of gross) p.push({ account: sellerAccount(sellerId), debit: 0, credit: g });
  if (totalMinor > goods) p.push({ account: 'platform:shipping', debit: 0, credit: totalMinor - goods });
  return p;
}

export interface FeeRow { sellerId: string; productId: string | null; category: string; saleMinor: number; referralMinor: number; closingMinor: number; paymentMinor: number; gstMinor: number }

export function feeRows(schedule: FeeScheduleTerms, lines: PaymentLine[]): FeeRow[] {
  return lines.map((l) => {
    const f = lineFees(schedule, l.category, l.unitPriceMinor, l.qty);
    return { sellerId: l.sellerId, productId: l.productId, category: l.category, saleMinor: f.saleMinor, referralMinor: f.referralMinor, closingMinor: f.closingMinor, paymentMinor: f.paymentMinor, gstMinor: f.gstMinor };
  });
}

/** One FEE transaction per seller; `reverse` builds the mirror image (cancellation before shipping). */
export function feePostings(rows: FeeRow[], reverse = false): Map<string, Posting[]> {
  const bySeller = new Map<string, { fees: number; gst: number }>();
  for (const r of rows) {
    const a = bySeller.get(r.sellerId) ?? { fees: 0, gst: 0 };
    a.fees += r.referralMinor + r.closingMinor + r.paymentMinor;
    a.gst += r.gstMinor;
    bySeller.set(r.sellerId, a);
  }
  const out = new Map<string, Posting[]>();
  for (const [sellerId, { fees, gst }] of bySeller) {
    const p: Posting[] = [
      { account: sellerAccount(sellerId), debit: fees + gst, credit: 0 },
      { account: 'platform:fees', debit: 0, credit: fees },
      { account: 'tax:gst_payable', debit: 0, credit: gst },
    ];
    out.set(sellerId, reverse ? p.map((x) => ({ account: x.account, debit: x.credit, credit: x.debit })) : p);
  }
  return out;
}

/**
 * Allocate a refund across the capture's credit side (seller payables + shipping) pro rata, largest remainder,
 * so partial refunds stay balanced to the paisa. A full refund reverses the capture exactly.
 */
export function refundPostings(amountMinor: number, totalMinor: number, lines: PaymentLine[]): Posting[] {
  if (amountMinor <= 0 || amountMinor > totalMinor) throw new Error('refund amount must be within the captured amount');
  const credits = capturePostings(totalMinor, lines).filter((p) => p.credit > 0);
  const shares = credits.map((c) => {
    const exact = (amountMinor * c.credit) / totalMinor;
    return { account: c.account, amount: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = amountMinor - shares.reduce((a, s) => a + s.amount, 0);
  for (const s of [...shares].sort((a, b) => b.rem - a.rem)) {
    if (left <= 0) break;
    s.amount += 1;
    left -= 1;
  }
  return [...shares.filter((s) => s.amount > 0).map((s) => ({ account: s.account, debit: s.amount, credit: 0 })), { account: 'gateway:clearing', debit: 0, credit: amountMinor }];
}

export const isBalanced = (p: Posting[]) => p.reduce((a, x) => a + x.debit, 0) === p.reduce((a, x) => a + x.credit, 0);
