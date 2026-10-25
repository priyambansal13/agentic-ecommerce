/** Demo data: this service's slice of the shared demo universe → its own database only. `pnpm seed` */
import { demoWorld, replaceRows } from '@ac/demo-data';
import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ENTITIES } from './modules/dashboard/entities/alert.entity.js';

loadServiceEnv();
const ds = serviceDataSource(ENTITIES);
await ds.initialize();
await ds.runMigrations();
const w = demoWorld();
const count = await replaceRows((sql, p) => ds.query(sql, p as unknown[]), 'alerts', ['id', 'subject_type', 'subject', 'score', 'decision', 'status', 'rules', 'raised_at'],
  w.fraudAlerts.map((a) => [a.id, a.subjectType, a.subject, a.score, a.decision, a.status, JSON.stringify(a.rules), a.raisedAt]));
console.log(`fraud seed: ${count} alerts`);
await ds.destroy();
