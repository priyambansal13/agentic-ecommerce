import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'daily_sales' })
export class DailySalesEntity {
  @PrimaryColumn('uuid', { name: 'seller_id' }) sellerId: string;
  @PrimaryColumn('date') day: string;
  @Column('int') orders: number;
  @Column('int') units: number;
  @Column('bigint', { name: 'gross_minor' }) grossMinor: string;
  @Column('bigint', { name: 'refunds_minor' }) refundsMinor: string;
}

@Entity({ name: 'product_sales' })
export class ProductSalesEntity {
  @PrimaryColumn('uuid', { name: 'seller_id' }) sellerId: string;
  @PrimaryColumn('uuid', { name: 'product_id' }) productId: string;
  @Column('text') title: string;
  @Column('int') units: number;
  @Column('bigint', { name: 'gross_minor' }) grossMinor: string;
}

@Entity({ name: 'seller_payouts' })
export class SellerPayoutEntity {
  @PrimaryColumn('uuid', { name: 'payout_id' }) payoutId: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('bigint', { name: 'amount_minor' }) amountMinor: string;
  @Column('text') status: string;
  @Column('date', { name: 'scheduled_on' }) scheduledOn: string;
  @Column('timestamptz', { name: 'paid_at', nullable: true }) paidAt: Date | null;
}

export const ENTITIES = [DailySalesEntity, ProductSalesEntity, SellerPayoutEntity];
