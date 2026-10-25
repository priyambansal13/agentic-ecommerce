import { Module } from '@nestjs/common';
import { CoreModule } from '@ac/nest-common';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ImagesModule } from './modules/images/images.module.js';
import { MarketplaceModule } from './modules/marketplace/marketplace.module.js';

/**
 * Catalog service — see platform/docs/02-lld.md and 07-microservices.md.
 * Owns its database exclusively; other services are reached via Kong APIs and Kafka events only.
 * Feature modules go in src/modules/<feature>/ (controller → service → repository, entities/, dto/).
 */
@Module({
  imports: [CoreModule.forService({ name: 'catalog', database: true }), DashboardModule, MarketplaceModule, ImagesModule],
})
export class AppModule {}
