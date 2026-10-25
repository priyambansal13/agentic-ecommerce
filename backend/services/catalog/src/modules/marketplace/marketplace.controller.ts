import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type BrandApplicationInput,
  BrandApplicationInputSchema,
  type DecisionInput,
  DecisionInputSchema,
  type OfferInput,
  OfferInputSchema,
  type ProductInput,
  ProductInputSchema,
} from '@ac/contracts';
import { Principal, type PrincipalInfo, Public, Roles, ZodPipe } from '@ac/nest-common';
import { z } from 'zod';
import { BrandsService } from './brands.service.js';
import { ListingsService } from './listings.service.js';
import { OffersService } from './offers.service.js';

const OfferUpdate = z.object({ priceMinor: z.int().positive().optional(), active: z.boolean().optional() }).refine((v) => v.priceMinor !== undefined || v.active !== undefined, 'priceMinor or active is required');
const SearchQuery = z.object({ q: z.string().trim().max(100).optional(), category: z.string().max(40).optional(), page: z.coerce.number().int().min(1).max(500).default(1) });

/** Public catalog: categories, product search and product pages (one page, many seller offers). */
@Controller()
export class CatalogController {
  constructor(private readonly listings: ListingsService, private readonly offers: OffersService) {}

  /** GET /v1/offers?ids=a,b — current offer prices for cart/checkout re-pricing (public data) */
  @Public()
  @Get('offers')
  offerLookup(@Query('ids') ids?: string) {
    return this.offers.lookup(ids);
  }

  /** PATCH /v1/offers/:id — seller edits price / pauses the offer (emits catalog.offer_updated.v1) */
  @Roles('seller')
  @Patch('offers/:id')
  updateOffer(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(OfferUpdate)) body: z.infer<typeof OfferUpdate>) {
    return this.offers.update(p.sub, id, body);
  }

  @Public()
  @Get('categories')
  categories() {
    return this.listings.categories();
  }

  @Public()
  @Get('products')
  search(@Query(new ZodPipe(SearchQuery)) q: z.infer<typeof SearchQuery>) {
    return this.listings.search(q.q || undefined, q.category || undefined, q.page);
  }

  @Public()
  @Get('products/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.listings.detail(id);
  }

  /** POST /v1/products — new product in the shared catalog + my first offer (→ moderation) */
  @Roles('seller')
  @Post('products')
  createProduct(@Principal() p: PrincipalInfo, @Body(new ZodPipe(ProductInputSchema)) body: ProductInput) {
    return this.listings.createProduct(p.sub, body);
  }

  /** POST /v1/offers — sell an existing published product */
  @Roles('seller')
  @Post('offers')
  createOffer(@Principal() p: PrincipalInfo, @Body(new ZodPipe(OfferInputSchema)) body: OfferInput) {
    return this.listings.createOffer(p.sub, body);
  }

  @Roles('seller')
  @Get('sellers/me/listings')
  myListings(@Principal() p: PrincipalInfo) {
    return this.listings.mine(p.sub);
  }

  @Roles('seller')
  @Get('sellers/me/eligibility')
  eligibility(@Principal() p: PrincipalInfo) {
    return this.listings.eligibility(p.sub);
  }
}

/** Brand Registry: sellers apply, brand owners authorize resellers, the brand team decides. */
@Controller()
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Roles('seller')
  @Post('brands/applications')
  apply(@Principal() p: PrincipalInfo, @Body(new ZodPipe(BrandApplicationInputSchema)) body: BrandApplicationInput) {
    return this.brands.apply(p.sub, body);
  }

  @Roles('seller')
  @Get('brands/mine')
  mine(@Principal() p: PrincipalInfo) {
    return this.brands.mine(p.sub);
  }

  @Roles('seller')
  @Put('brands/:brandId/resellers/:sellerId')
  authorize(@Principal() p: PrincipalInfo, @Param('brandId', ParseUUIDPipe) brandId: string, @Param('sellerId', ParseUUIDPipe) sellerId: string) {
    return this.brands.setReseller(p.sub, brandId, sellerId, true);
  }

  @Roles('seller')
  @Delete('brands/:brandId/resellers/:sellerId')
  revoke(@Principal() p: PrincipalInfo, @Param('brandId', ParseUUIDPipe) brandId: string, @Param('sellerId', ParseUUIDPipe) sellerId: string) {
    return this.brands.setReseller(p.sub, brandId, sellerId, false);
  }

  @Roles('brand-team', 'admin')
  @Get('brand-applications/queue')
  queue() {
    return this.brands.queue();
  }

  @Roles('brand-team', 'admin')
  @Post('brand-applications/:id/decision')
  @HttpCode(200)
  decide(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DecisionInputSchema)) d: DecisionInput) {
    return this.brands.decide(id, d, p.sub);
  }
}
