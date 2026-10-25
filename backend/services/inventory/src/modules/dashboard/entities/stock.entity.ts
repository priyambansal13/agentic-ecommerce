import { Column, Entity, PrimaryColumn, VersionColumn } from 'typeorm';

@Entity({ name: 'stock' })
export class StockEntity {
  @PrimaryColumn('uuid', { name: 'sku_id' }) skuId: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text') sku: string;
  @Column('uuid', { name: 'product_id', nullable: true }) productId: string | null;
  @Column('text') title: string;
  @Column('int', { name: 'on_hand' }) onHand: number;
  @Column('int') reserved: number;
  @Column('int', { name: 'low_stock_threshold' }) lowStockThreshold: number;
  @VersionColumn() version: number;
}

export const ENTITIES = [StockEntity];
