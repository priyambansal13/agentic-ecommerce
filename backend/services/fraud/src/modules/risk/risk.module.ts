import { Module } from '@nestjs/common';
import { RiskController } from './risk.controller.js';
import { RiskService } from './risk.service.js';

@Module({ controllers: [RiskController], providers: [RiskService] })
export class RiskModule {}
