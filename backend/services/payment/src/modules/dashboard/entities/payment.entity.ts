import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'payments' })
export class PaymentEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'order_id', unique: true }) orderId: string;
  @Column('bigint', { name: 'amount_minor' }) amountMinor: string;
  @Column('char', { length: 3 }) currency: string;
  @Column('text') status: string;
  @Column('timestamptz', { name: 'captured_at' }) capturedAt: Date;
}

@Entity({ name: 'refunds' })
export class RefundEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'refund_case_id', unique: true }) refundCaseId: string; // idempotency anchor
  @Column('bigint', { name: 'amount_minor' }) amountMinor: string;
  @Column('char', { length: 3 }) currency: string;
  @Column('text') status: string;
  @Column('timestamptz', { name: 'created_at' }) createdAt: Date;
}

@Entity({ name: 'payouts' })
export class PayoutEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text', { name: 'seller_name' }) sellerName: string;
  @Column('bigint', { name: 'amount_minor' }) amountMinor: string;
  @Column('char', { length: 3 }) currency: string;
  @Column('text') status: string;
  @Column('date', { name: 'scheduled_on' }) scheduledOn: string;
  @Column('timestamptz', { name: 'paid_at', nullable: true }) paidAt: Date | null;
}

@Entity({ name: 'ledger_entries' })
export class LedgerEntryEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column('uuid', { name: 'tx_id' }) txId: string;
  @Column('text') kind: string;
  @Column('text') account: string;
  @Column('bigint', { name: 'debit_minor' }) debitMinor: string;
  @Column('bigint', { name: 'credit_minor' }) creditMinor: string;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt: Date;
}

export const ENTITIES = [PaymentEntity, RefundEntity, PayoutEntity, LedgerEntryEntity];
