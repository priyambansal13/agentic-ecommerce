// Flash sale: N concurrent buyers race for one hot SKU with exactly STOCK units → zero oversell.
// Drives the inventory reservation API directly (the checkout saga's step 4) with a service token, so the
// test isolates the conditional-UPDATE guarantee from cart/payment latency.
//
//   AC_K6_SERVICE_TOKEN=$(…client_credentials token of the `services` client…) AC_K6_SKU=<offer id with on_hand = 100> \
//     node scripts/ac.mjs k6 flash-sale.js
// Thresholds: exactly STOCK reservations succeed, everything else is a clean 409 INSUFFICIENT_STOCK, no 5xx.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BUYERS = Number(__ENV.BUYERS ?? 1000);
const STOCK = Number(__ENV.STOCK ?? 100);
const reserved = new Counter('reserved_ok');
const soldOut = new Counter('sold_out_409');
const unexpected = new Counter('unexpected_status');

export const options = {
  scenarios: { rush: { executor: 'shared-iterations', vus: BUYERS, iterations: BUYERS, maxDuration: '2m' } },
  thresholds: {
    reserved_ok: [`count==${STOCK}`],
    sold_out_409: [`count==${BUYERS - STOCK}`],
    unexpected_status: ['count==0'],
  },
};

const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

export default function () {
  const r = http.post(
    `${__ENV.BASE_URL}/api/inventory/v1/internal/reservations`,
    JSON.stringify({ orderId: uuid(), ttlSec: 60, lines: [{ skuId: __ENV.SKU, qty: 1 }] }),
    { headers: { 'content-type': 'application/json', authorization: `Bearer ${__ENV.SERVICE_TOKEN}` }, timeout: '60s' },
  );
  if (r.status === 201) reserved.add(1);
  else if (r.status === 409 && r.json('code') === 'INSUFFICIENT_STOCK') soldOut.add(1);
  else unexpected.add(1);
  check(r, { 'reserved or sold out': (x) => x.status === 201 || x.status === 409 });
}
