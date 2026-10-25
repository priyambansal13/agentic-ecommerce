import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrandsService } from './brands.service.js';
import { MARKETPLACE_ENTITIES } from './entities.js';
import { ListingsService } from './listings.service.js';
import { BrandsController, CatalogController } from './marketplace.controller.js';
import { MarketplaceEvents } from './marketplace.events.js';
import { OffersService } from './offers.service.js';

@Module({
  imports: [TypeOrmModule.forFeature(MARKETPLACE_ENTITIES)],
  controllers: [CatalogController, BrandsController],
  providers: [ListingsService, BrandsService, MarketplaceEvents, OffersService],
})
export class MarketplaceModule {}
