import { Module } from '@nestjs/common';
import { StockController } from './stock.controller.js';
import { StockEvents } from './stock.events.js';
import { StockService } from './stock.service.js';

@Module({ controllers: [StockController], providers: [StockService, StockEvents], exports: [StockService] })
export class StockModule {}
