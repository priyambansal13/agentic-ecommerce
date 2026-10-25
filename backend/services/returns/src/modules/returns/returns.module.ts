import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { type CloudEvent, Events, TOPICS } from '@ac/contracts';
import { EventConsumerService } from '@ac/nest-common';
import type { EntityManager } from 'typeorm';
import { ObjectStore } from './object-store.js';
import { InternalController, ReturnsController, StaffController } from './returns.controller.js';
import { ReturnsService } from './returns.service.js';

/** payment.events → refund confirmation (payment.refunded.v1 → case REFUNDED). */
@Injectable()
export class PaymentEventsConsumer implements OnModuleInit {
  private readonly log = new Logger(PaymentEventsConsumer.name);
  constructor(private readonly events: EventConsumerService, private readonly returns: ReturnsService) {}

  async onModuleInit() {
    await this.events.subscribe('returns-payments', [TOPICS.payment], (e, tx) => this.handle(e, tx));
  }

  async handle(evt: CloudEvent, tx: EntityManager) {
    if (evt.type !== 'payment.refunded.v1') return;
    const r = Events['payment.refunded.v1'].safeParse(evt);
    if (!r.success) return this.log.error(`skipping invalid payment.refunded.v1 ${evt.id}`);
    await this.returns.onRefunded(tx, r.data.data);
  }
}

@Module({
  controllers: [ReturnsController, InternalController, StaffController],
  providers: [ReturnsService, ObjectStore, PaymentEventsConsumer],
})
export class ReturnsModule {}
