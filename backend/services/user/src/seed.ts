/** Demo data: seller accounts (KYC) and gated-category approvals → this service's own database only. `pnpm seed` */
import { demoWorld, marketplaceWorld, replaceRows } from '@ac/demo-data';
import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { ENTITIES } from './modules/sellers/entities/seller-account.entity.js';
import { kycChecks } from './modules/sellers/kyc-checks.js';

loadServiceEnv();
const ds = serviceDataSource(ENTITIES);
await ds.initialize();
await ds.runMigrations();
const q = (sql: string, p?: unknown[]) => ds.query(sql, p as unknown[]);
const m = marketplaceWorld(demoWorld());
await q(`TRUNCATE TABLE kyc_history, category_approvals CASCADE`);
const accounts = await replaceRows(q, 'seller_accounts',
  ['seller_id', 'display_name', 'legal_name', 'business_type', 'gstin', 'pan', 'address', 'contact_email', 'contact_phone', 'bank', 'kyc_status', 'checks', 'submitted_at', 'decided_at', 'decided_by', 'decision_note', 'role_granted_at', 'created_at', 'updated_at'],
  m.sellerAccounts.map((a) => [a.sellerId, a.displayName, a.legalName, a.businessType, a.gstin, a.pan, JSON.stringify(a.address), a.contactEmail, a.contactPhone, JSON.stringify(a.bank), a.kycStatus,
    JSON.stringify(kycChecks(a, { gstin: 0, pan: 0 }).checks), a.submittedAt, a.decidedAt, a.decidedAt ? 'compliance (demo)' : null, a.decisionNote, a.kycStatus === 'VERIFIED' ? a.decidedAt : null, a.createdAt, a.decidedAt ?? a.createdAt]));
const history = await replaceRows(q, 'kyc_history', ['seller_id', 'from_status', 'to_status', 'actor', 'note', 'at'],
  m.sellerAccounts.flatMap((a) => [
    [a.sellerId, null, 'SUBMITTED', a.sellerId, null, a.submittedAt ?? a.createdAt],
    ...(a.decidedAt ? [[a.sellerId, 'SUBMITTED', a.kycStatus, 'compliance (demo)', a.decisionNote, a.decidedAt]] : []),
  ]));
const approvals = await replaceRows(q, 'category_approvals', ['id', 'seller_id', 'category', 'license_number', 'status', 'note', 'requested_at', 'decided_at', 'decided_by'],
  m.categoryApprovals.map((c) => [c.id, c.sellerId, c.category, c.licenseNumber, c.status, c.note, c.requestedAt, c.decidedAt, c.decidedAt ? 'category-team (demo)' : null]));
console.log(`user seed: ${accounts} seller_accounts, ${history} kyc_history, ${approvals} category_approvals`);
await ds.destroy();
