import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';

@Module({ providers: [NotificationsService] })
export class NotificationsModule {}
