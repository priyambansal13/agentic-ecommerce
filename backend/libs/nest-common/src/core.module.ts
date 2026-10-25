import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from './auth/auth.js';
import { DatabaseModule } from './database.module.js';
import { EventConsumerService } from './events/consumer.js';
import { OutboxRelay, OutboxService } from './events/outbox.js';
import { HealthController } from './health.controller.js';
import { IdempotencyInterceptor } from './idempotency.js';
import { InfraTables } from './infra-tables.js';
import { ServiceClient } from './service-client.js';
import { WhoAmIController } from './whoami.controller.js';

export interface CoreOptions {
  name: string;
  /** true when the service owns a database (DATABASE_URL); false for stateless services (e.g. search) */
  database: boolean;
}

/** Everything a microservice needs: auth guard, /health, /v1/whoami and (with a database) idempotency, outbox, consumers. */
@Module({})
export class CoreModule {
  static forService(opts: CoreOptions): DynamicModule {
    process.env.SERVICE_NAME ??= opts.name;
    const db = opts.database
      ? {
          imports: [DatabaseModule.forService()],
          providers: [InfraTables, OutboxService, OutboxRelay, EventConsumerService, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
          exports: [DatabaseModule, OutboxService, EventConsumerService],
        }
      : { imports: [], providers: [], exports: [] };
    return {
      module: CoreModule,
      global: true,
      imports: db.imports,
      controllers: [HealthController, WhoAmIController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }, { provide: ServiceClient, useFactory: () => new ServiceClient() }, ...db.providers],
      exports: [ServiceClient, ...db.exports],
    };
  }
}
