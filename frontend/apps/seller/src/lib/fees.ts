import { fmtMoney } from '@ac/ui';

/** Closing-fee bands → human text: “up to ₹300: ₹12”, “above ₹1,000: ₹60”. Bands are ordered by upToMinor, null last. */
export function bandText(bands: { upToMinor: number | null; feeMinor: number }[], cur = 'INR') {
  let prev = 0;
  return bands.map((b) => {
    const t = b.upToMinor === null ? `above ${fmtMoney(prev, cur)}` : prev === 0 ? `up to ${fmtMoney(b.upToMinor, cur)}` : `${fmtMoney(prev, cur)}–${fmtMoney(b.upToMinor, cur)}`;
    if (b.upToMinor !== null) prev = b.upToMinor;
    return { range: t, fee: fmtMoney(b.feeMinor, cur) };
  });
}
export const bps = (n: number) => `${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}%`;
