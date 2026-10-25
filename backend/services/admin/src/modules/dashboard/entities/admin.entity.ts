import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'moderation_items' })
export class ModerationItemEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'product_id' }) productId: string;
  @Column('text') title: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text', { name: 'seller_name' }) sellerName: string;
  @Column('text', { name: 'agent_verdict' }) agentVerdict: string;
  @Column('numeric', { precision: 3, scale: 2 }) confidence: string;
  @Column('jsonb') reasons: string[];
  @Column('text') status: string;
  @Column('text', { name: 'decided_by', nullable: true }) decidedBy: string | null;
  @Column('timestamptz', { name: 'created_at' }) createdAt: Date;
  @Column('timestamptz', { name: 'decided_at', nullable: true }) decidedAt: Date | null;
}

@Entity({ name: 'disputes' })
export class DisputeEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('text', { name: 'order_no' }) orderNo: string;
  @Column('text') status: string;
  @Column('timestamptz', { name: 'opened_at' }) openedAt: Date;
}

@Entity({ name: 'seller_sanctions' })
export class SellerSanctionEntity {
  @PrimaryColumn('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text') reason: string;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt: Date;
}

export const ENTITIES = [ModerationItemEntity, DisputeEntity, SellerSanctionEntity];
