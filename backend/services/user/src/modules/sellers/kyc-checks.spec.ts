import { describe, expect, it } from 'vitest';
import { gstinCheckChar, kycChecks } from './kyc-checks.js';

const app = (over: Record<string, unknown> = {}) => ({
  legalName: 'Sample Traders Private Limited', displayName: 'Sample', businessType: 'RETAILER' as const,
  gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F',
  address: { line1: '1 MG Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
  contactEmail: 'a@example.com', contactPhone: '9876543210',
  bank: { accountHolder: 'Sample Traders', ifsc: 'HDFC0001234', accountNumber: '50100012345' },
  ...over,
});

describe('GSTIN checksum', () => {
  it('matches known valid GSTINs', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(gstinCheckChar('29AAGCB7383J1Z')).toBe('4');
  });
  it('rejects characters outside 0-9A-Z', () => expect(gstinCheckChar('27aapfu0939F1Z')).toBeNull());
});

describe('kycChecks', () => {
  it('passes a consistent application', () => {
    const r = kycChecks(app(), { gstin: 0, pan: 0 });
    expect(r.blocking).toEqual([]);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });
  it('blocks a wrong check digit, PAN mismatch and wrong state', () => {
    const r = kycChecks(app({ gstin: '27AAPFU0939F1ZA', pan: 'AAPFU0939G', address: { line1: 'x', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' } }), { gstin: 0, pan: 0 });
    expect(r.blocking.map((c) => c.check)).toEqual(['gstin_checksum', 'pan_matches_gstin', 'gstin_state']);
  });
  it('flags duplicates without blocking', () => {
    const r = kycChecks(app(), { gstin: 1, pan: 2 });
    expect(r.blocking).toEqual([]);
    expect(r.checks.filter((c) => !c.passed).map((c) => c.check)).toEqual(['gstin_unique', 'pan_unique']);
  });
});
