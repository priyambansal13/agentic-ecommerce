import type { DataSource, EntityManager } from 'typeorm';

export interface Eligibility {
  verified: boolean;
  displayName: string;
  approvedCategories: string[];
  ownedBrands: { id: string; name: string }[];
  authorizedBrands: { id: string; name: string }[];
}

/** What a seller may list — from this service's own read model (user.events) and Brand Registry tables. */
export async function eligibilityOf(db: DataSource | EntityManager, sellerId: string): Promise<Eligibility> {
  const [e] = await db.query(`SELECT display_name, verified, approved_categories FROM seller_eligibility WHERE seller_id = $1`, [sellerId]);
  const owned = await db.query(`SELECT id, name FROM brands WHERE owner_seller_id = $1 ORDER BY name`, [sellerId]);
  const authorized = await db.query(`SELECT b.id, b.name FROM brand_resellers r JOIN brands b ON b.id = r.brand_id WHERE r.seller_id = $1 ORDER BY b.name`, [sellerId]);
  return { verified: !!e?.verified, displayName: e?.display_name ?? 'Unknown seller', approvedCategories: e?.approved_categories ?? [], ownedBrands: owned, authorizedBrands: authorized };
}
