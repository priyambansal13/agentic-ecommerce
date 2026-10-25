import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Registered for TypeORM metadata; the marketplace module queries with SQL (conditional updates, joins). */
@Entity({ name: 'brands' })
export class BrandEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('text') name: string;
  @Column('uuid', { name: 'owner_seller_id' }) ownerSellerId: string;
  @Column('boolean') restricted: boolean;
}

@Entity({ name: 'offers' })
export class OfferEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'product_id' }) productId: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('bigint', { name: 'price_minor' }) priceMinor: string;
  @Column('text') status: string;
}

@Entity({ name: 'categories' })
export class CategoryEntity {
  @PrimaryColumn('text') id: string;
  @Column('text') name: string;
  @Column('boolean') gated: boolean;
}

export const MARKETPLACE_ENTITIES = [BrandEntity, OfferEntity, CategoryEntity];
