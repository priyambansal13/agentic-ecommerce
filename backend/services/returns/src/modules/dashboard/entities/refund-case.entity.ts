import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'refund_cases' })
export class RefundCaseEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'order_id' }) orderId: string;
  @Column('text', { name: 'order_no' }) orderNo: string;
  @Column('uuid', { name: 'buyer_id' }) buyerId: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text') reason: string;
  @Column('text') status: string;
  @Column('bigint', { name: 'requested_minor' }) requestedMinor: string;
  @Column('bigint', { name: 'proposed_minor', nullable: true }) proposedMinor: string | null;
  @Column('bigint', { name: 'approved_minor', nullable: true }) approvedMinor: string | null;
  @Column('char', { length: 3 }) currency: string;
  @Column('numeric', { name: 'risk_score', precision: 4, scale: 2, nullable: true }) riskScore: string | null;
  @Column('text', { name: 'required_role', nullable: true }) requiredRole: string | null;
  @Column('text', { name: 'agent_rationale', nullable: true }) agentRationale: string | null;
  @Column('text', { name: 'decided_by', nullable: true }) decidedBy: 'agent' | 'human' | null;
  @Column('timestamptz', { name: 'opened_at' }) openedAt: Date;
  @Column('timestamptz', { name: 'resolved_at', nullable: true }) resolvedAt: Date | null;
}

export const ENTITIES = [RefundCaseEntity];
