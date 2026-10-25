import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CategoryRequestInputSchema, type DecisionInput, DecisionInputSchema, type SellerApplicationInput, SellerApplicationInputSchema } from '@ac/contracts';
import { Principal, type PrincipalInfo, Roles, ZodPipe } from '@ac/nest-common';
import { SellersService } from './sellers.service.js';

/** Seller registration & KYC (caller = applicant) and gated-category requests. */
@Controller('sellers/me')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  /** GET /v1/sellers/me — my seller account (404 = not applied yet) */
  @Roles('buyer', 'seller')
  @Get()
  me(@Principal() p: PrincipalInfo) {
    return this.sellers.me(p.sub);
  }

  /** PUT /v1/sellers/me — save the application draft */
  @Roles('buyer', 'seller')
  @Put()
  save(@Principal() p: PrincipalInfo, @Body(new ZodPipe(SellerApplicationInputSchema)) body: SellerApplicationInput) {
    return this.sellers.saveDraft(p.sub, body);
  }

  /** POST /v1/sellers/me/submit — send for compliance review */
  @Roles('buyer', 'seller')
  @Post('submit')
  @HttpCode(200)
  submit(@Principal() p: PrincipalInfo) {
    return this.sellers.submit(p.sub);
  }

  /** GET /v1/sellers/me/categories — categories and my approval status for gated ones */
  @Roles('seller')
  @Get('categories')
  categories(@Principal() p: PrincipalInfo) {
    return this.sellers.categories(p.sub);
  }

  /** POST /v1/sellers/me/categories/:category { licenseNumber } */
  @Roles('seller')
  @Post('categories/:category')
  @HttpCode(200)
  request(@Principal() p: PrincipalInfo, @Param('category') category: string, @Body(new ZodPipe(CategoryRequestInputSchema)) body: { licenseNumber: string }) {
    return this.sellers.requestCategory(p.sub, category, body.licenseNumber);
  }
}

/** Compliance: KYC review queue. */
@Controller('kyc')
export class KycController {
  constructor(private readonly sellers: SellersService) {}

  @Roles('compliance', 'admin')
  @Get('queue')
  queue() {
    return this.sellers.kycQueue();
  }

  @Roles('compliance', 'admin')
  @Post(':sellerId/decision')
  @HttpCode(200)
  decide(@Principal() p: PrincipalInfo, @Param('sellerId', ParseUUIDPipe) sellerId: string, @Body(new ZodPipe(DecisionInputSchema)) d: DecisionInput) {
    return this.sellers.decideKyc(sellerId, d, p.sub);
  }
}

/** Category team: gated-category approval queue. */
@Controller('category-approvals')
export class CategoryApprovalsController {
  constructor(private readonly sellers: SellersService) {}

  @Roles('category-team', 'admin')
  @Get('queue')
  queue() {
    return this.sellers.categoryQueue();
  }

  @Roles('category-team', 'admin')
  @Post(':id/decision')
  @HttpCode(200)
  decide(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DecisionInputSchema)) d: DecisionInput) {
    return this.sellers.decideCategory(id, d, p.sub);
  }
}
