import { describe, expect, it } from 'vitest';
import { parseEvent } from './index.js';

describe('event contracts', () => {
  it('accepts a valid order.created.v1 and rejects a wrong type', () => {
    const evt = {
      specversion: '1.0',
      id: '01JB8XZ0000000000000000000',
      source: 'order',
      type: 'order.created.v1',
      time: '2026-10-20T10:01:02Z',
      data: {
        orderId: '0b7e6f2a-5f43-4d8e-9a43-6f3a1c2d4e5f',
        buyerId: '1c8f7a3b-6e54-4f9f-8b54-7a4b2d3e5f60',
        total: { amountMinor: 459900, currency: 'INR' },
        lines: [{ skuId: '2d9a8b4c-7f65-4a0a-9c65-8b5c3e4f6071', sellerId: '3e0b9c5d-8a76-4b1b-8d76-9c6d4f5a7182', qty: 1, unitPriceMinor: 459900 }],
      },
    };
    expect(parseEvent('order.created.v1', evt).data.total.amountMinor).toBe(459900);
    expect(() => parseEvent('order.created.v1', { ...evt, type: 'order.created.v2' })).toThrow();
  });
});
