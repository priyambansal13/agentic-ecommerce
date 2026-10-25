import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogCategories } from './catalog-categories.js';
import { ENTITIES } from './entities/seller-account.entity.js';
import { KeycloakAdmin } from './keycloak-admin.js';
import { CategoryApprovalsController, KycController, SellersController } from './sellers.controller.js';
import { SellersService } from './sellers.service.js';

@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  controllers: [SellersController, KycController, CategoryApprovalsController],
  providers: [SellersService, KeycloakAdmin, CatalogCategories],
})
export class SellersModule {}
