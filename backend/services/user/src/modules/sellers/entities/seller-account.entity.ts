import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Registered for TypeORM metadata; queries are SQL in the services (status machines use conditional UPDATEs). */
@Entity({ name: 'seller_accounts' })
export class SellerAccountEntity {
  @PrimaryColumn('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text', { name: 'display_name' }) displayName: string;
  @Column('text', { name: 'kyc_status' }) kycStatus: string;
  @Column('int') version: number;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt: Date;
}

@Entity({ name: 'category_approvals' })
export class CategoryApprovalEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('text') category: string;
  @Column('text') status: string;
  @Column('int') version: number;
}

export const ENTITIES = [SellerAccountEntity, CategoryApprovalEntity];
