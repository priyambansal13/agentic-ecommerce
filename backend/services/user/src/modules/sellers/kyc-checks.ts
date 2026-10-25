import type { Check, SellerApplicationInput } from '@ac/contracts';

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check character: mod-36 over the first 14 characters with alternating weights 1, 2. */
export function gstinCheckChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = B36.indexOf(first14[i]);
    if (v < 0) return null;
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}

/** GST state codes (first two GSTIN digits). */
export const GST_STATE_CODES: Record<string, string> = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07',
  Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10', Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14',
  Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21', Chhattisgarh: '22',
  'Madhya Pradesh': '23', Gujarat: '24', 'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29', Goa: '30',
  Lakshadweep: '31', Kerala: '32', 'Tamil Nadu': '33', Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36',
  'Andhra Pradesh': '37', Ladakh: '38',
};
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/&/g, 'and');

export interface KycCheckResult { checks: Check[]; blocking: Check[] }

/**
 * Automated KYC checks. Blocking ones (identity consistency) stop submission; the rest are shown to compliance.
 * `duplicates` = other accounts already using this GSTIN / PAN.
 */
export function kycChecks(a: SellerApplicationInput, duplicates: { gstin: number; pan: number }): KycCheckResult {
  const expected = gstinCheckChar(a.gstin.slice(0, 14));
  const stateEntry = Object.entries(GST_STATE_CODES).find(([name]) => norm(name) === norm(a.address.state));
  const blockingChecks: Check[] = [
    { check: 'gstin_checksum', passed: expected === a.gstin[14], detail: expected === a.gstin[14] ? 'GSTIN check digit is valid' : 'GSTIN check digit does not match — please re-check the number' },
    { check: 'pan_matches_gstin', passed: a.gstin.slice(2, 12) === a.pan, detail: a.gstin.slice(2, 12) === a.pan ? 'PAN matches characters 3–12 of the GSTIN' : 'PAN does not match the PAN embedded in the GSTIN' },
    {
      check: 'gstin_state',
      passed: !!stateEntry && stateEntry[1] === a.gstin.slice(0, 2),
      detail: !stateEntry ? `Unknown state "${a.address.state}"` : stateEntry[1] === a.gstin.slice(0, 2) ? `GSTIN state code ${stateEntry[1]} matches ${stateEntry[0]}` : `GSTIN state code ${a.gstin.slice(0, 2)} does not match ${stateEntry[0]} (${stateEntry[1]})`,
    },
  ];
  const info: Check[] = [
    { check: 'ifsc_format', passed: /^[A-Z]{4}0[A-Z0-9]{6}$/.test(a.bank.ifsc), detail: `IFSC ${a.bank.ifsc}` },
    { check: 'gstin_unique', passed: duplicates.gstin === 0, detail: duplicates.gstin ? `GSTIN already used by ${duplicates.gstin} other account(s)` : 'GSTIN not used by another seller' },
    { check: 'pan_unique', passed: duplicates.pan === 0, detail: duplicates.pan ? `PAN already used by ${duplicates.pan} other account(s)` : 'PAN not used by another seller' },
  ];
  return { checks: [...blockingChecks, ...info], blocking: blockingChecks.filter((c) => !c.passed) };
}
