import { describe, expect, it } from 'vitest';
import { AUTO_APPROVE_CONFIDENCE, prescreen } from './prescreen.js';

const good = { title: 'Trailblaze trekking poles, carbon, pair', description: 'Lightweight carbon trekking poles with cork grips and quick locks, tested on Himalayan trails.', bullets: ['Carbon shafts', 'Cork grips'] };

describe('prescreen', () => {
  it('auto-approves a clean listing', () => {
    const r = prescreen(good);
    expect(r.verdict).toBe('APPROVE');
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_APPROVE_CONFIDENCE);
  });
  it('rejects counterfeit wording', () => expect(prescreen({ ...good, title: 'Nimbus earbuds first copy' }).verdict).toBe('REJECT'));
  it('sends claims and thin content to a human', () => {
    const r = prescreen({ ...good, description: 'Miracle oil, cures hair fall', bullets: ['x'] });
    expect(r.verdict).toBe('NEEDS_REVIEW');
    expect(r.confidence).toBeLessThan(AUTO_APPROVE_CONFIDENCE);
    expect(r.reasons).toContain('medical or guaranteed-result claim');
  });
});
