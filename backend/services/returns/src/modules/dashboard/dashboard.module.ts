import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { ENTITIES } from './entities/refund-case.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
