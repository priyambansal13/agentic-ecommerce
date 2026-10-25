import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type CloudEvent, type EventData, type EventType, Events, TOPICS } from '@ac/contracts';
import { EventConsumerService } from '@ac/nest-common';
import type { EntityManager } from 'typeorm';
import { PaymentsService } from './payments.service.js';

/** order.events → local order lines (fee allocation) and refunds/cancellation when an order is cancelled. */
@Injectable()
export class OrderEventsConsumer implements OnModuleInit {
  private readonly log = new Logger(OrderEventsConsumer.name);
  constructor(private readonly events: EventConsumerService, private readonly payments: PaymentsService) {}

  async onModuleInit() {
    await this.events.subscribe('payment-orders', [TOPICS.order], (e, tx) => this.handle(e, tx));
  }

  /** Invalid events are logged and skipped (recorded as processed) so one bad message cannot block the partition. */
  private parse<T extends EventType>(type: T, evt: CloudEvent): EventData<T> | null {
    const r = Events[type].safeParse(evt);
    if (!r.success) this.log.error(`skipping invalid ${type} ${evt.id}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    return r.success ? (r.data.data as EventData<T>) : null;
  }

  async handle(evt: CloudEvent, tx: EntityManager) {
    if (evt.type === 'order.created.v1') {
      const d = this.parse('order.created.v1', evt);
      if (d) await this.payments.onOrderCreated(tx, d);
    } else if (evt.type === 'order.cancelled.v1') {
      const d = this.parse('order.cancelled.v1', evt);
      if (d) await this.payments.onOrderCancelled(tx, d);
    }
  }
}
