// k6 smoke test: every microservice through Kong + every zone through the shell.
//   ac k6 smoke.js        (BASE_URL = Kong, WEB_URL = shell; injected by the CLI)
// Phase 1+ adds: search 100 RPS steady / 300 RPS burst, flash-sale checkout (docs/05 §5.4).
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:58000';
const WEB = __ENV.WEB_URL || 'http://localhost:3300';
const SERVICES = ['user', 'catalog', 'search', 'inventory', 'order', 'payment', 'returns', 'fraud', 'notification', 'admin', 'seller-analytics'];
const ZONES = ['', '/shop', '/account', '/seller', '/admin'];

export const options = {
  vus: 5,
  duration: '20s',
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{kind:api}': ['p(95)<300'] },
};

export default function () {
  for (const s of SERVICES) {
    check(http.get(`${BASE}/api/${s}/health`, { tags: { kind: 'api', service: s } }), { [`${s} healthy`]: (r) => r.status === 200 });
  }
  for (const z of ZONES) {
    check(http.get(`${WEB}${z}/api/health`, { tags: { kind: 'zone', zone: z || '/' } }), { [`zone ${z || '/'} healthy via shell`]: (r) => r.status === 200 });
  }
  // /api/agents is rate-limited at Kong (60/min per IP — LLM cost guard), so probe it lightly
  if (__VU === 1 && __ITER % 3 === 0) {
    const run = http.post(
      `${WEB}/admin/api/agents/ping/run`,
      JSON.stringify({ threadId: `k6-${__VU}-${__ITER}`, runId: `${__VU}-${__ITER}`, messages: [{ id: 'm', role: 'user', content: 'hi' }], state: {}, tools: [], context: [], forwardedProps: {} }),
      { headers: { 'content-type': 'application/json' }, tags: { kind: 'agent' } },
    );
    check(run, { 'agent run via shell → admin zone BFF → Kong': (r) => r.status === 200 && r.body.includes('RUN_FINISHED') });
  }
  sleep(1);
}
