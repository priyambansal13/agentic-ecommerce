import { type DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';

/**
 * Database-per-service: each microservice owns one database (`ac_<db>`, owner role `svc_<db>`) and gets
 * exactly one connection string, DATABASE_URL. No other service has credentials for it.
 * Databases/roles are created by `ac infra init` (local) or the db-bootstrap Job (k8s).
 * Migrations (src/migrations → dist/migrations) run at boot, before the service reports healthy, so a new
 * version only takes traffic once its schema is in place. synchronize is off — see the db-migration skill.
 */
export function serviceDbOptions(extra: Partial<DataSourceOptions> = {}): DataSourceOptions {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set — run `ac configure` in the platform repo');
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    applicationName: process.env.SERVICE_NAME,
    synchronize: false,
    migrations: [join(process.cwd(), 'dist', 'migrations', '*.js')],
    migrationsTableName: 'schema_migrations',
    extra: { max: Number(process.env.DB_POOL_MAX ?? 10) },
    ...extra,
  } as DataSourceOptions;
}

/** For the TypeORM CLI and seed scripts: `export default serviceDataSource([Entity…])` in src/data-source.ts. */
export function serviceDataSource(entities: DataSourceOptions['entities'] = []) {
  return new DataSource(serviceDbOptions({ entities }));
}

@Module({})
export class DatabaseModule {
  static forService(): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ ...serviceDbOptions(), autoLoadEntities: true, migrationsRun: true }),
        }),
      ],
      exports: [TypeOrmModule],
    };
  }
}
