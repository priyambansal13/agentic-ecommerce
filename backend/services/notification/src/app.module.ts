import { Module } from '@nestjs/common';
import { CoreModule } from '@ac/nest-common';
import { NotificationsModule } from './modules/notifications/notifications.module.js';

/**
 * Notification service — see platform/docs/02-lld.md and 07-microservices.md.
 * Owns its database exclusively; other services are reached via Kong APIs and Kafka events only.
 * Feature modules go in src/modules/<feature>/ (controller → service → repository, entities/, dto/).
 */
@Module({
  imports: [CoreModule.forService({ name: 'notification', database: true }), NotificationsModule],
})
export class AppModule {}
