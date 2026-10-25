import { Column, CreateDateColumn, Entity, PrimaryColumn, VersionColumn } from 'typeorm';

@Entity({ name: 'products' })
export class ProductEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text') sku: string;
  @Column('text') title: string;
  @Column('text') category: string;
  @Column('bigint', { name: 'price_minor' }) priceMinor: string;
  @Column('char', { length: 3 }) currency: string;
  @Column('text') status: string;
  @VersionColumn() version: number;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt: Date;
}

export const ENTITIES = [ProductEntity];
