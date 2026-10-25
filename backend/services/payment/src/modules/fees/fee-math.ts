/**
 * Marketplace fee math (pure, integer minor units). Per order line:
 *   sale     = price × qty
 *   referral = max(round(sale × referralBps / 10 000), minReferral × qty)   — category rule, '*' = default
 *   closing  = closing fee of the price band (first band with upTo ≥ price; null = open-ended) × qty
 *   payment  = round(sale × paymentFeeBps / 10 000)
 *   gst      = round((referral + closing + payment) × gstBps / 10 000)       — GST is charged on the fees
 *   earns    = sale − (referral + closing + payment + gst)
 * Rounding is half-up (all values are non-negative).
 */
export interface ClosingBand { upToMinor: number | null; feeMinor: number }
export interface FeeRule { category: string; referralBps: number; minReferralMinor: number; closingFees: ClosingBand[] }
export interface FeeScheduleTerms { version: number; paymentFeeBps: number; gstBps: number; rules: FeeRule[] }
export interface LineFees { saleMinor: number; referralMinor: number; closingMinor: number; paymentMinor: number; gstMinor: number; totalFeesMinor: number; sellerEarnsMinor: number }

export const DEFAULT_CATEGORY = '*';
const bps = (amount: number, rate: number) => Math.floor((amount * rate + 5_000) / 10_000);

export function ruleFor(s: FeeScheduleTerms, category: string): FeeRule {
  const rule = s.rules.find((r) => r.category === category) ?? s.rules.find((r) => r.category === DEFAULT_CATEGORY);
  if (!rule) throw new Error(`fee schedule v${s.version} has no rule for ${category} and no '*' default`);
  return rule;
}

export function closingFee(bands: ClosingBand[], priceMinor: number) {
  const band = bands.find((b) => b.upToMinor === null || priceMinor <= b.upToMinor);
  return band?.feeMinor ?? bands[bands.length - 1].feeMinor;
}

export function lineFees(s: FeeScheduleTerms, category: string, priceMinor: number, quantity: number): LineFees {
  const rule = ruleFor(s, category);
  const saleMinor = priceMinor * quantity;
  const referralMinor = Math.max(bps(saleMinor, rule.referralBps), rule.minReferralMinor * quantity);
  const closingMinor = closingFee(rule.closingFees, priceMinor) * quantity;
  const paymentMinor = bps(saleMinor, s.paymentFeeBps);
  const gstMinor = bps(referralMinor + closingMinor + paymentMinor, s.gstBps);
  const totalFeesMinor = referralMinor + closingMinor + paymentMinor + gstMinor;
  return { saleMinor, referralMinor, closingMinor, paymentMinor, gstMinor, totalFeesMinor, sellerEarnsMinor: saleMinor - totalFeesMinor };
}

/** Structural checks a schedule must pass before it can be saved/submitted. Returns problems (empty = ok). */
export function validateTerms(s: Pick<FeeScheduleTerms, 'rules'>): string[] {
  const problems: string[] = [];
  if (!s.rules.some((r) => r.category === DEFAULT_CATEGORY)) problems.push(`a '${DEFAULT_CATEGORY}' default rule is required`);
  const seen = new Set<string>();
  for (const r of s.rules) {
    if (seen.has(r.category)) problems.push(`duplicate rule for ${r.category}`);
    seen.add(r.category);
    const b = r.closingFees;
    if (b[b.length - 1]?.upToMinor !== null) problems.push(`${r.category}: the last closing-fee band must be open-ended (upToMinor null)`);
    for (let i = 1; i < b.length; i++) {
      const prev = b[i - 1].upToMinor;
      const cur = b[i].upToMinor;
      if (prev === null || (cur !== null && cur <= prev)) problems.push(`${r.category}: closing-fee bands must be in ascending price order`);
    }
  }
  return problems;
}

/** Schedule v1 (demo/launch): referral % per category, closing fee by price band, 2 % payment fee, 18 % GST on fees. */
const BANDS: ClosingBand[] = [
  { upToMinor: 30_000, feeMinor: 500 },
  { upToMinor: 50_000, feeMinor: 1_000 },
  { upToMinor: 100_000, feeMinor: 2_000 },
  { upToMinor: null, feeMinor: 4_000 },
];
export const LAUNCH_SCHEDULE: FeeScheduleTerms = {
  version: 1,
  paymentFeeBps: 200,
  gstBps: 1_800,
  rules: [
    { category: 'electronics', referralBps: 800, minReferralMinor: 0, closingFees: BANDS },
    { category: 'fashion', referralBps: 1_700, minReferralMinor: 0, closingFees: BANDS },
    { category: 'home', referralBps: 1_200, minReferralMinor: 0, closingFees: BANDS },
    { category: 'grocery', referralBps: 500, minReferralMinor: 0, closingFees: BANDS },
    { category: 'outdoor', referralBps: 900, minReferralMinor: 0, closingFees: BANDS },
    { category: 'beauty', referralBps: 1_000, minReferralMinor: 0, closingFees: BANDS },
    { category: 'books', referralBps: 600, minReferralMinor: 0, closingFees: BANDS },
    { category: 'jewellery', referralBps: 1_500, minReferralMinor: 2_000, closingFees: BANDS },
    { category: DEFAULT_CATEGORY, referralBps: 1_200, minReferralMinor: 0, closingFees: BANDS },
  ],
};
