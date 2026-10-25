import { Global, Module } from '@nestjs/common';
import { FeesController } from './fees.controller.js';
import { FeesService } from './fees.service.js';

@Global()
@Module({ controllers: [FeesController], providers: [FeesService], exports: [FeesService] })
export class FeesModule {}
