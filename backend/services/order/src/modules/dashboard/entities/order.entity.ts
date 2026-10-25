import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'orders' })
export class OrderEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('text', { name: 'order_no', unique: true }) orderNo: string;
  @Column('uuid', { name: 'buyer_id' }) buyerId: string;
  @Column('text') status: string;
  @Column('bigint', { name: 'total_minor' }) totalMinor: string;
  @Column('char', { length: 3 }) currency: string;
  @Column('int') items: number;
  @Column('timestamptz', { name: 'placed_at' }) placedAt: Date;
  @Column('timestamptz', { name: 'shipped_at', nullable: true }) shippedAt: Date | null;
  @Column('timestamptz', { name: 'delivered_at', nullable: true }) deliveredAt: Date | null;
  @Column('text', { name: 'ship_to_name', nullable: true }) shipToName: string | null;
  @Column('text', { name: 'ship_to_city', nullable: true }) shipToCity: string | null;
}

@Entity({ name: 'seller_orders' })
export class SellerOrderEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'order_id' }) orderId: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text') status: string;
  @Column('int') items: number;
  @Column('bigint', { name: 'total_minor' }) totalMinor: string;
  @Column('timestamptz', { name: 'placed_at' }) placedAt: Date;
}

@Entity({ name: 'order_lines' })
export class OrderLineEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column('uuid', { name: 'order_id' }) orderId: string;
  @Column('uuid', { name: 'product_id' }) productId: string;
  @Column('text') title: string;
  @Column('text') category: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text', { name: 'seller_name' }) sellerName: string;
  @Column('int') qty: number;
  @Column('bigint', { name: 'unit_price_minor' }) unitPriceMinor: string;
}

export const ENTITIES = [OrderEntity, SellerOrderEntity, OrderLineEntity];
