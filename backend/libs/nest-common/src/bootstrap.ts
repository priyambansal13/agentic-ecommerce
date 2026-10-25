import 'reflect-metadata';
import { Logger, VersioningType, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadServiceEnv } from './env.js';

export interface ServiceOptions {
  name: string;
  /** default port; PORT env overrides */
  port: number;
  bodyLimitBytes?: number;
  /** register service-specific Fastify plugins (e.g. @fastify/multipart) before listening */
  beforeListen?: (app: NestFastifyApplication) => Promise<void>;
}

/** Standard microservice bootstrap: service .env (+ shared backend .env), Fastify, URI versioning (/v1/...), shutdown hooks. */
export async function bootstrapService(module: Type<unknown>, opts: ServiceOptions): Promise<NestFastifyApplication> {
  loadServiceEnv();
  process.env.SERVICE_NAME ??= opts.name;
  const adapter = new FastifyAdapter({ trustProxy: true, bodyLimit: opts.bodyLimitBytes ?? 1_048_576 });
  const app = await NestFactory.create<NestFastifyApplication>(module, adapter);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  await opts.beforeListen?.(app);
  const port = Number(process.env.PORT ?? opts.port);
  await app.listen(port, '0.0.0.0');
  Logger.log(`${opts.name} on http://localhost:${port} (health /health, API /v1/...)`, 'Bootstrap');
  return app;
}
